const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')
const ask = require('just-ask')
const { log } = require('./src/utils')
const args = process.argv.slice(2)
const argKeepOrig = args.includes('--keep')
const argNoAsk = args.includes('--stfu')

function findInDir (dir, filter, fileList = []) {
  const files = fs.readdirSync(dir)
  files.forEach((file) => {
    const filePath = path.join(dir, file)
    const fileStat = fs.lstatSync(filePath)
    if (fileStat.isDirectory()) {
      findInDir(filePath, filter, fileList)
    } else if (filter.test(filePath)) {
      fileList.push(filePath)
    }
  })
  return fileList
}

function getBitRate (fn) {
  let probe = {}
  try {
    const cmd = `ffprobe -v quiet -print_format json -show_format "./${fn}"`
    probe = childProcess.execSync(cmd, { stdio: 'pipe', encoding: 'utf8' })
    probe = JSON.parse(probe)
  } catch (err) {
    log.error(`ffprobe failed at "${fn}"`)
  }
  return Math.floor((probe.format || { bit_rate: 0 }).bit_rate / 1000)
}

function getTargetName (fn) {
  const base = path.basename(fn)
  const newName = base.toLowerCase() // add extra cleanup here
    .replace(/^(\d+)\./, '$1') // remove dot after track count
    .replace(/\.(mp3|flac|mpc|ogg)$/, '.128.$1') // add "128" marker
  return fn.substr(0, fn.lastIndexOf(base)) + newName
}

// ---

async function main () {
  let fileNames = findInDir('.', /\.(mp3|flac|mpc|ogg)$/)
  fileNames = fileNames.filter(fn => fn.split('.').slice(-2)[0] !== '128') // ignore "foo.128.mp3" files
  fileNames = fileNames.filter(fn => !/^\./.test(path.basename(fn))) // ignore dotfiles

  if (fileNames.length === 0) {
    log.info('No files found.')
    return 0
  }

  log.info(`Found ${fileNames.length} music file(s)`)
  if (!argNoAsk) {
    const sub = argKeepOrig ? '' : ' AND the originals '
    let response = await ask(`I'll delete mp3ish dotfiles${sub} + do a recursive conversion, are you sure? [y/n/i]`)
    if (/^(i|info|h|help|\?)$/i.test(response)) {
      log.info(fileNames.map(name => `▷ ${name}`).join('\n'))
      response = await ask('May we continue? [y/n]')
    }
    if (!/^(y|yes)$/i.test(response)) {
      log.info('Bye then')
      return 0
    }
  }

  // delete dotfiles with mp3ish file extensions
  fileNames.forEach(fn => {
    const base = path.basename(fn)
    const dir = fn.substr(0, fn.lastIndexOf(base))
    const dotFn = `${dir}.${base}`
    const macFn = `${dir}._${base}`
    if (fs.existsSync(dotFn)) {
      log.warn(`Deleting ${dotFn}`)
      fs.unlinkSync(dotFn)
    }
    if (fs.existsSync(macFn)) {
      log.warn(`Deleting ${macFn}`)
      fs.unlinkSync(macFn)
    }
  })

  fileNames = fileNames.filter(fn => getBitRate(fn) > 128)
  log.info(`Files with high bitrates: ${fileNames.length}`)
  fileNames.forEach(fn => {
    const target = getTargetName(fn)
    if (fs.existsSync(target)) {
      log.info(`Skipping "${fn}", target already exists`)
      return
    }
    // LAME is single threaded, so there's not much point in passing -threads
    const cmd = `ffmpeg -hide_banner -loglevel warning -y -i "${fn}" -map 0:a:0 -b:a 128k "${target}"`
    let output = ''
    let error = false
    log.info(`Converting "${fn}" --> ".../${target}"`)
    try {
      output = childProcess.execSync(cmd, { stdio: 'pipe' })
    } catch (err) {
      error = err
      log.error('Could not execute ffmpeg!', err, output)
    }
    if (!error && !argKeepOrig) {
      log.warn(`Deleting original "${fn}"`)
      fs.unlinkSync(fn)
    }
  })
}

// ===

main().then(val => {
  process.exit(val || 0)
}).catch(err => {
  log.error('Uncaught error in main promise!', err)
  process.exit(1)
})
