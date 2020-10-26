const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')
const ask = require('just-ask')
const args = process.argv.slice(2)
const argKeepOrig = args.includes('--keep')

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
    console.error(`ERR ffprobe failed at "${fn}"`)
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
    console.info('No files found.')
    return 0
  }

  console.info(`INF found ${fileNames.length} music file(s)`)
  const response = await ask('WARN I\'ll delete mp3ish dotfiles and do a recursive conversion, are you sure?')
  if (!/^(y|yes)$/i.test(response)) {
    return
  }

  // delete dotfiles with mp3ish file extensions
  fileNames.forEach(fn => {
    const base = path.basename(fn)
    const dir = fn.substr(0, fn.lastIndexOf(base))
    const dotFn = `${dir}.${base}`
    const macFn = `${dir}._${base}`
    if (fs.existsSync(dotFn)) {
      console.warn(`DEL ${dotFn}`)
      fs.unlinkSync(dotFn)
    }
    if (fs.existsSync(macFn)) {
      console.warn(`DEL ${macFn}`)
      fs.unlinkSync(macFn)
    }
  })

  fileNames = fileNames.filter(fn => getBitRate(fn) > 128)
  console.info(`INF ${fileNames.length} of those have high bit rates`)
  fileNames.forEach(fn => {
    const target = getTargetName(fn)
    if (fs.existsSync(target)) {
      console.info(`INF skipping "${fn}", target already exists`)
      return
    }
    // LAME is single threaded, so there's not much point in passing -threads
    const cmd = `ffmpeg -hide_banner -loglevel warning -y -i "${fn}" -map 0:a:0 -b:a 128k "${target}"`
    let output = ''
    let error = false
    console.info(`INF converting "${fn}" --> ".../${target}"`)
    try {
      output = childProcess.execSync(cmd, { stdio: 'pipe' })
    } catch (err) {
      error = err
      console.error('ERR', err, output)
    }
    if (!error && !argKeepOrig) {
      console.warn(`DEL original "${fn}"`)
      fs.unlinkSync(fn)
    }
  })
}

// ===

main().catch(err => console.error)
