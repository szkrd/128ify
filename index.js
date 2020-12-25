const os = require('os')
const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')
const ask = require('just-ask')
const { gray, greenBright } = require('chalk')
const { log, sleep } = require('./src/utils')
const args = process.argv.slice(2)
const argKeepOrig = args.includes('--keep')
const argNoAsk = args.includes('--stfu')
const showHelp = args.includes('--help') || args.includes('-h')
const MAX_PARALLEL = Math.max(os.cpus().length, 2) - 1

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
  if (showHelp) {
    log.info('The script is interactive, will ask for confirmation before doing anything destructive.')
    log.info('Params:\n--stfu = do not ask for confirmation\n--keep = do not delete the original files after the conversion')
    return 0
  }
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
      log.info(fileNames.map(name => `* ${name}`).join('\n'))
      response = await ask('May we continue? [y/n]')
    }
    if (!/^(y|yes)$/i.test(response)) {
      log.info('Bye then')
      return 0
    }
  }

  // delete dotfiles with mp3ish file extensions (macos hidden metadata)
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

  // skip low bitrates (and rename orig)
  fileNames = fileNames.filter(fn => {
    const isHigh = getBitRate(fn) > 128
    if (!isHigh) {
      const target = getTargetName(fn)
      fs.renameSync(fn, target)
      log.info(`Skipping "${fn}", bitrate is already low enough (renaming)`)
    }
    return isHigh
  })

  // skip the ones that already have a .128.mp3 pair (and delete orig)
  fileNames = fileNames.filter(fn => {
    const target = getTargetName(fn)
    if (fs.existsSync(target)) {
      let postfix = ''
      if (!argKeepOrig) {
        fs.unlinkSync(fn)
        postfix = ' (also deleted the original)'
      }
      log.info(`Skipping "${fn}", target .128.mp3 already exists${postfix}`)
      return false
    }
    return true
  })

  log.info(`Files with high bitrates: ${fileNames.length}`)
  let processedItemsCount = 0
  let inProgressCount = 0
  const convertFile = (fn, onFinish) => {
    const target = getTargetName(fn)
    // LAME is single threaded, so there's not much point in passing -threads
    const cmd = `ffmpeg -hide_banner -loglevel warning -y -i "${fn}" -map 0:a:0 -b:a 128k "${target}"`
    log.info(`Converting "${fn}" --> ".../${target}"`)
    // first execute ffmpeg, then delete the old file
    inProgressCount++
    childProcess.exec(cmd, { stdio: 'pipe' }, (error, stdout, stderr) => {
      if (error) {
        log.error('Could not execute ffmpeg!', { error, stdout, stderr })
        processedItemsCount++
        inProgressCount--
        return onFinish(error)
      }
      if (!argKeepOrig) {
        log.warn(`Deleting original "${fn}"`)
        fs.unlink(fn, (error, stdout, stderr) => {
          if (error) {
            log.error(`Could not delete "${fn}"`, { error, stdout, stderr })
          }
          processedItemsCount++
          inProgressCount--
          return onFinish(error)
        })
      }
    })
  }

  // the main loop
  log.info(`\nStart conversion, using ${MAX_PARALLEL} core(s)...`)
  let currentItemIndex = 0
  const pad = (s, p = '') => String(s).padStart(3, p)
  while (processedItemsCount < fileNames.length) {
    // if we have capacity, then start encoding another item
    if (inProgressCount < MAX_PARALLEL && currentItemIndex < fileNames.length) {
      const fn = fileNames[currentItemIndex++]
      convertFile(fn, (error) => {
        log.info(greenBright(
          `#${pad(currentItemIndex)} Finished processing "${fn}"` +
          `-> ${error ? 'ERROR' : 'OK'}`
        ))
      })
    }
    // print progress at every tick
    log.info(gray(
      `[items: ${pad(fileNames.length)}, ` +
      `processed: ${pad(processedItemsCount)}, ` +
      `in progress: ${pad(inProgressCount)}] ` +
      `${Math.round(processedItemsCount / fileNames.length * 100)}%`
    ))
    await sleep()
  }
}

// ===

main().then(val => {
  process.exit(val || 0)
}).catch(err => {
  log.error('Uncaught error in main promise!', err)
  process.exit(1)
})
