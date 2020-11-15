const chalk = require('chalk')

function log (...args) { console.log(...args) }
log.error = (...args) => console.error(chalk.red(args[0]), ...args.slice(1))
log.warn = (...args) => console.warn(chalk.yellow(args[0]), ...args.slice(1))
log.info = (...args) => console.log(...args)

function sleep (n = 1000) {
  return new Promise(resolve => {
    setTimeout(resolve, n)
  })
}

module.exports = {
  log,
  sleep
}
