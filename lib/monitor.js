/* eslint-disable no-await-in-loop */
import { MongoClient } from 'mongodb';
import log from 'npmlog';
import { notifyError } from '../util/logger.js';


export default class monitor {
  constructor(config) {
    // Make sure config passed in
    if (!config) {
      throw new Error('Please provide a valid config file to use mongomonitor.');
    }

    // Save it for later
    this.config = config;
  }

  async runHealthChecks() {
    // Traverse replica set members
    // eslint-disable-next-line no-restricted-syntax
    for (const host of this.config.members) {
      // Connection handle
      let client;
      try {
        let authCred = '';
        let authSource = '';
        if (this.config.auth.username !== undefined || this.config.auth.password !== undefined) {
          authCred = `${this.config.auth.username}:${this.config.auth.password}@`;
        }
        if (this.config.authSource) {
          authSource += `?authSource=${this.config.auth.authSource}`;
        }
        const url = `mongodb://${authCred}${host}/${this.config.database}?${authSource}`;
        client = new MongoClient(url, { directConnection: true });

        // Attempt to connect to current member
        await client.connect();
      }
      catch (err) {
        console.log(err);
        // Log fatal error and continue to next member
        notifyError(new Error(`Failed to connect to replica set member: ${host}.`, err), this.config);
        continue;
      }

      try {
        log.info('mongomonitor', new Date(), 'Running health checks');

        // Check that the member is healthy
        let db = client.db('admin');
        await this.verifyMemberHealthy(db, host);

        // Check that disk space is not running out
        db = client.db(this.config.database);
        await this.verifySufficientDiskSpace(db, host);

        // Make sure oplog length is long enough to survive a replica set data member failure
        db = client.db('local');
        await this.verifySufficientOplogLength(db, host);
      }
      finally {
        // Close DB connection;
        client.close();
      }
    }
  }

  async verifyMemberHealthy(db, host) {
    // Run 'rs.status()' on the node
    const rs = await db.command({ replSetGetStatus: 1 });

    // Run 'rs.config()' on the node
    const config = await db.command({ replSetGetConfig: 1 });

    // Get a count of the votes available
    const votes = config.config.members.reduce((acc, member) => acc + member.votes, 0);


    // Problem with replica set?
    if (!rs.ok) {
      notifyError(new Error(`Replica set status on host ${host} is not OK.`), this.config);
    }

    // Missing member(s)?
    if (rs.members.length < this.config.minReplicaSetMembers) {
      notifyError(new Error(`Replica set configuration on host ${host} contains only ${rs.members.length} members (minimum: ${this.config.minReplicaSetMembers}).`), this.config);
    }

    // Even number of votes?
    if (votes % 2 === 0) {
      notifyError(new Error(`Replica set configuration on host ${host} contains an even number of votes (${votes}) across ${rs.members.length} members which will cause primary elections to fail.`), this.config);
    }

    // Verify at least one primary and secondary member exists
    let primary;
    let secondary;

    // Traverse members
    // eslint-disable-next-line no-restricted-syntax
    for (const member of rs.members) {
      // Found primary?
      if (member.state === 1) {
        primary = member;
      }
      // Found secondary?
      if (member.state === 2) {
        secondary = member;
      }

      // Unhealthy?
      if (!member.health) {
        notifyError(new Error(`${member.name} reported an unhealthy status as seen from host ${host} (state: ${member.stateStr}).`), this.config);
      }

      // Verify that member is connected by checking its last heartbeat timestamp
      if (member.lastHeartbeat && member.lastHeartbeat.getTime() < new Date().getTime() - (1000 * 60 * this.config.maxHeartbeatThreshold)) {
        notifyError(new Error(`${member.name} appears to be disconnected from host ${host} (last heartbeat: ${member.lastHeartbeat}).`), this.config);
      }

      // Secondary member (and not an arbiter)?
      if (member.syncingTo && member.state !== 7) {
        // Verify that oplog date is recent, otherwise server is falling behind on replication
        if (member.optimeDate.getTime() < new Date().getTime() - (1000 * 60 * this.config.maxReplicationDelay)) {
          notifyError(new Error(`${member.name} (secondary) appears to be falling behind on replication (optime date: ${member.optimeDate}).`), this.config);
        }
      }
    }
  }

  async verifySufficientDiskSpace(db, host) {
    // Get collection stats
    const stats = await db.stats();
    // get total size of all disk aspace in use on the file system where mongoDB stores data.
    const fsTotalSize = stats.fsTotalSize / (1024 * 1024 * 1024);

    // get size of all disk space in use on the filesystem where MongoDB stores data.
    const fsUsedSize = stats.fsUsedSize / (1024 * 1024 * 1024);

    let storagePercentage = ((fsTotalSize - fsUsedSize) / fsTotalSize) * 100;

    // round to 2 digits
    storagePercentage = (Math.round(storagePercentage * 100) / 100).toFixed(2);

    if (storagePercentage < this.config.alertOnRemainingStoragePer) {
      // console.log(`Database has only remaining ${storagePercentage}% storage size`);
      notifyError(new Error(`Database has only remaining ${storagePercentage}% storage size on host ${host}`), this.config);
    }

    // Get DB storage size in GB (from bytes)
    // var totalSize = stats.totalSize / 1024 / 1024 / 1024;

    // Check for an exceeding storage size
    // if (totalSize > this.config.maxDatabaseSize) {
    //    notifyError(new Error(`Database storage size ${totalSize} GB has exceeded ${this.config.maxDatabaseSize}.`), this.config);
    // }
  }

  async verifySufficientOplogLength(db, host) {
    // Get DB member type to check if data member
    const memberType = await db.command({ hello: 1 });

    // No replication happens on arbiters
    if (memberType.arbiterOnly) {
      return;
    }

    // Get "local" sibling DB and "oplog.rs" collection
    const collection = await db.collection('oplog.rs');

    // Get oldest document in collection which indicates how far the oplog dates
    const cursor = collection.find({}, { sort: { $natural: 1 }, limit: 1 });

    // Convert cursor to array
    const data = await cursor.toArray();

    // Failed?
    if (data.length === 0) {
      return notifyError(new Error(`Failed to retrieve oldest oplog timestamp for host ${host}.`), this.config);
    }

    // Get first (and only) document
    const oplog = data[0];
    // Get oldest oplog document timestamp
    const timestamp = oplog.ts.getHighBits();

    // Get current unix timestamp
    const nowTimestamp = Math.round(new Date().getTime() / 1000);


    // Calculate number of minutes the oplog length spans
    const lengthMinutes = Math.round((nowTimestamp - timestamp) / 60);

    // Check whether the oplog length is insufficient
    if (lengthMinutes < this.config.minOplogLength) {
      notifyError(new Error(`Database oplog length for ${host} is only ${lengthMinutes.toLocaleString()} minutes long.`), this.config);
    }
  }

  startMonitoring() {
    // Run the task runner which calls itself recursively
    this.taskRunner();
    setInterval(() => {
      this.taskRunner();
    }, this.config.interval * 1000);
  }

  async taskRunner() {
    await this.runHealthChecks(this.config);
  }
}
