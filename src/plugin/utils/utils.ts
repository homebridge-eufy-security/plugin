import { Logger, ILogObj, ISettingsParam } from 'tslog';
import { Characteristic, HAP as HAPHB, Service } from 'homebridge';

export let HAP: HAPHB;
export let SERV: typeof Service;
export let CHAR: typeof Characteristic;

export function setHap(hapInstance: HAPHB) {
  HAP = hapInstance;
  SERV = hapInstance.Service;
  CHAR = hapInstance.Characteristic;
}

export let log: Logger<ILogObj> = {} as Logger<ILogObj>;
export let tsLogger: Logger<ILogObj> = {} as Logger<ILogObj>;
export let ffmpegLogger: Logger<ILogObj> = {} as Logger<ILogObj>;

export let logOptions: ISettingsParam<ILogObj> = {
  name: '[EufySecurity]', // Name prefix for log messages
  prettyLogTemplate: '[{{mm}}/{{dd}}/{{yyyy}}, {{hh}}:{{MM}}:{{ss}}]\t{{name}}\t{{logLevelName}}\t', // Template for pretty log output
  prettyErrorTemplate: '\n{{errorName}} {{errorMessage}}\nerror stack:\n{{errorStack}}', // Template for pretty error output
  prettyErrorStackTemplate: '  • {{fileName}}\t{{method}}\n\t{{fileNameWithLine}}', // Template for error stack trace
  prettyErrorParentNamesSeparator: '', // Separator for parent names in error messages
  prettyErrorLoggerNameDelimiter: '\t', // Delimiter for logger name in error messages
  stylePrettyLogs: true, // Enable styling for logs
  minLevel: 3, // Minimum log level to display (3 corresponds to INFO)
  prettyLogTimeZone: 'local' as 'local' | 'local', // Time zone for log timestamps
  prettyLogStyles: { // Styles for different log elements
    logLevelName: { // Styles for log level names
      '*': ['bold', 'black', 'bgWhiteBright', 'dim'], // Default style
      SILLY: ['bold', 'white'], // Style for SILLY level
      TRACE: ['bold', 'whiteBright'], // Style for TRACE level
      DEBUG: ['bold', 'green'], // Style for DEBUG level
      INFO: ['bold', 'blue'], // Style for INFO level
      WARN: ['bold', 'yellow'], // Style for WARN level
      ERROR: ['bold', 'red'], // Style for ERROR level
      FATAL: ['bold', 'redBright'], // Style for FATAL level
    },
    dateIsoStr: 'gray', // Style for ISO date strings
    filePathWithLine: 'white', // Style for file paths with line numbers
    name: 'green', // Style for logger names
    nameWithDelimiterPrefix: ['white', 'bold'], // Style for logger names with delimiter prefix
    nameWithDelimiterSuffix: ['white', 'bold'], // Style for logger names with delimiter suffix
    errorName: ['bold', 'bgRedBright', 'whiteBright'], // Style for error names
    fileName: ['yellow'], // Style for file names
  },
  maskValuesOfKeys: [ // Keys whose values should be masked in logs
    'username',
    'password',
    'token',
    'clientPrivateKey',
    'private_key',
    'login_hash',
    'serverPublicKey',
    'cloud_token',
    'refreshToken',
    'p2p_conn',
    'app_conn',
    'address',
    'latitude',
    'longitude',
    'serialnumber',
    'serialNumber',
    'stationSerialNumber',
    'data',
    'ignoreStations',
    'ignoreDevices',
    'pincode',
  ],
};

export function init_log(debug: boolean = false) {

  // Retrieve plugin information from package.json
  const plugin = require('../../package.json');

  // Modify log options if detailed logging is enabled
  if (debug) {
    logOptions.name = `[EufySecurity-${plugin.version}]`; // Modify logger name with plugin version
    logOptions.prettyLogTemplate = '[{{mm}}/{{dd}}/{{yyyy}} {{hh}}:{{MM}}:{{ss}}]\t{{name}}\t{{logLevelName}}\t[{{fileNameWithLine}}]\t'; // Modify log template
    logOptions.minLevel = 2; // Adjust minimum log level
  }

  log = new Logger(logOptions);
  logOptions.type = 'hidden';
  tsLogger = new Logger(logOptions);
  ffmpegLogger = new Logger(logOptions);
}
