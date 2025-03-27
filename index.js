#!/usr/bin/env node
import path from 'path';
import log from 'npmlog';
import program from 'commander';
import fs from 'fs';
import monitor from './lib/monitor.js';

// import monitor from "./lib/monitor";

// Define CLI arguments and options
program
.version('1.0.0')
.option('--test-email', 'send a test e-mail to verify SMTP config')
.option('-c, --config <path>', 'provide a custom path to the mongomonitor config file')
.parse(process.argv);

// Determine absolute path to config file
const configPath = path.resolve(program.config || 'config.json');

// Log config file path
log.info('mongomonitor', `Initializing using the following config file: ${configPath}`);


// Attempt to load config file
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Start monitoring
new monitor(config).startMonitoring();

