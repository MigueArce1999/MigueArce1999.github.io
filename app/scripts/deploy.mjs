#!/usr/bin/env node
/**
 * Despliegue interactivo a Hostinger (FTP): pregunta URL, local, host, usuario y
 * contraseña; construye la SPA con ese VITE_LOCAL_ID y sube el interior de dist.
 */
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'basic-ftp'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const distDir = join(appDir, 'dist')
const envLocalPath = join(appDir, '.env.local')
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function cargarEnvLocal() {
  const out = {}
  if (!existsSync(envLocalPath)) return out
  for (const linea of readFileSync(envLocalPath, 'utf8').split('\n')) {
    const t = linea.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 1) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  return out
}

async function preguntar(rl, etiqueta, { defecto } = {}) {
  const sufijo = defecto ? ` [${defecto}]` : ''
  const r = (await rl.question(`${etiqueta}${sufijo}: `)).trim()
  const final = r || defecto || ''
  if (!final) throw new Error(`Falta: ${etiqueta}`)
  return final
}

function leerOculto(etiqueta) {
  return new Promise((resolve, reject) => {
    output.write(`${etiqueta}: `)
    const stdin = input
    if (!stdin.isTTY) {
      reject(new Error('No hay terminal interactiva para la contraseña.'))
      return
    }
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let value = ''
    const onData = (ch) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        cleanup()
        output.write('\n')
        if (!value) reject(new Error('Falta: Contraseña FTP'))
        else resolve(value)
      } else if (ch === '\u0003') {
        cleanup()
        output.write('\n')
        process.exit(1)
      } else if (ch === '\u007f' || ch === '\b') {
        value = value.slice(0, -1)
      } else if (ch === '\u0015') {
        value = ''
      } else {
        value += ch
      }
    }
    function cleanup() {
      stdin.removeListener('data', onData)
      stdin.setRawMode(false)
    }
    stdin.on('data', onData)
  })
}

function hostnameDeUrl(sitio) {
  const conEsquema = /^https?:\/\//i.test(sitio) ? sitio : `https://${sitio}`
  const u = new URL(conEsquema)
  return u.hostname.replace(/^www\./i, '')
}

function patronRedirectAuth(sitio) {
  const conEsquema = /^https?:\/\//i.test(sitio) ? sitio : `https://${sitio}`
  try {
    const u = new URL(conEsquema)
    return `${u.protocol}//${u.host}/**`
  } catch {
    return null
  }
}

function normalizarHostFtp(host) {
  return host
    .trim()
    .replace(/^(ftp|ftps|sftp):\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
}

function listarArchivos(dir, acc = []) {
  for (const nombre of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, nombre.name)
    if (nombre.isDirectory()) listarArchivos(ruta, acc)
    else acc.push(ruta)
  }
  return acc
}

function valorEnv(env, ...claves) {
  for (const k of claves) {
    const v = (env[k] || process.env[k] || '').trim()
    if (v) return v
  }
  return ''
}

function guardarEnvLocal(valores) {
  const lineas = [
    '### Generado por npm run deploy. No subir al git.',
    `VITE_SUPABASE_URL=${valores.VITE_SUPABASE_URL}`,
    `VITE_SUPABASE_ANON_KEY=${valores.VITE_SUPABASE_ANON_KEY}`,
    `VITE_LOCAL_ID=${valores.VITE_LOCAL_ID}`,
    `VITE_SITE_URL=${valores.VITE_SITE_URL}`,
    `FTP_HOST=${valores.FTP_HOST}`,
    `FTP_USER=${valores.FTP_USER}`,
    `FTP_REMOTE=${valores.FTP_REMOTE}`,
    '',
  ]
  writeFileSync(envLocalPath, lineas.join('\n'))
}

async function resolverDestino(client, pedido) {
  const inicio = await client.pwd()
  const yaEnPublicHtml = /\/public_html\/?$/i.test(inicio.replace(/\\/g, '/'))
  const pidePublicHtml = !pedido || pedido === '.' || pedido === './' || /^public_html\/?$/i.test(pedido)

  if (yaEnPublicHtml && pidePublicHtml) {
    output.write(`El FTP ya está en ${inicio} (raíz del sitio). No se crea otro public_html.\n`)
    return inicio
  }
  if (!pedido || pedido === '.' || pedido === './') {
    output.write(`Carpeta FTP actual: ${inicio}\n`)
    return inicio
  }
  try {
    await client.cd(pedido)
    const dest = await client.pwd()
    output.write(`Carpeta FTP: ${dest}\n`)
    return dest
  } catch (err) {
    output.write(
      `No se pudo entrar a "${pedido}" (${err.message}). Subiendo en ${inicio}\n`,
    )
    await client.cd(inicio)
    return inicio
  }
}

async function subirDist(client, baseRemoto) {
  const archivos = listarArchivos(distDir)
  if (archivos.length === 0) throw new Error('dist/ está vacío. El build no generó archivos.')
  for (const local of archivos) {
    const rel = relative(distDir, local).replaceAll('\\', '/')
    const partes = rel.split('/')
    const archivo = partes.pop()
    await client.cd(baseRemoto)
    for (const p of partes) {
      await client.ensureDir(p)
    }
    await client.uploadFrom(local, archivo)
    output.write(`  ↑ ${rel}\n`)
  }
}

const envArchivo = cargarEnvLocal()
const rl = createInterface({ input, output })

let ftpPass = ''
try {
  output.write('\nDespliegue a Hostinger (FTP)\n')
  output.write('Enter confirma el valor de .env.local. Escribe otro solo si quieres cambiarlo.\n')
  output.write('La contraseña FTP no se guarda.\n\n')

  const sitioDefecto = valorEnv(envArchivo, 'VITE_SITE_URL', 'SITE_URL')
  const localIdDefecto = valorEnv(envArchivo, 'VITE_LOCAL_ID')
  const ftpHostDefecto = valorEnv(envArchivo, 'FTP_HOST')
  const ftpUserDefecto = valorEnv(envArchivo, 'FTP_USER')
  const remotoDefecto = valorEnv(envArchivo, 'FTP_REMOTE') || 'public_html'

  const sitio = await preguntar(rl, 'URL del sitio', { defecto: sitioDefecto })
  const hostName = hostnameDeUrl(sitio)

  const localId = await preguntar(rl, 'ID del local (VITE_LOCAL_ID)', { defecto: localIdDefecto })
  if (!UUID.test(localId)) {
    throw new Error(
      'El ID del local debe ser un UUID (ej. c1a4d1a4-c1a4-41a4-81a4-c1a4d1a40001), no un número. ' +
        'Está en la tabla `local` o lo devuelve fn_provisionar_local.',
    )
  }

  const ftpHost = normalizarHostFtp(
    await preguntar(rl, 'Host FTP', { defecto: ftpHostDefecto || `ftp.${hostName}` }),
  )
  const ftpUser = await preguntar(rl, 'Usuario FTP', { defecto: ftpUserDefecto })
  const remotoPedido = await preguntar(rl, 'Carpeta remota', {
    defecto: remotoDefecto,
  })

  let supabaseUrl = envArchivo.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  let supabaseKey = envArchivo.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
  if (!supabaseUrl) supabaseUrl = await preguntar(rl, 'VITE_SUPABASE_URL (no está en .env.local)')
  if (!supabaseKey) supabaseKey = await preguntar(rl, 'VITE_SUPABASE_ANON_KEY (no está en .env.local)')

  rl.close()
  ftpPass = await leerOculto('Contraseña FTP')

  guardarEnvLocal({
    VITE_SUPABASE_URL: supabaseUrl,
    VITE_SUPABASE_ANON_KEY: supabaseKey,
    VITE_LOCAL_ID: localId,
    VITE_SITE_URL: /^https?:\/\//i.test(sitio) ? sitio : `https://${sitio}`,
    FTP_HOST: ftpHost,
    FTP_USER: ftpUser,
    FTP_REMOTE: remotoPedido,
  })

  output.write(`\nSitio:  ${sitio}\nLocal:  ${localId}\nFTP:    ${ftpUser}@${ftpHost} → ${remotoPedido}\n\nConstruyendo…\n`)

  const envBuild = {
    ...process.env,
    VITE_SUPABASE_URL: supabaseUrl,
    VITE_SUPABASE_ANON_KEY: supabaseKey,
    VITE_LOCAL_ID: localId,
  }
  const build = spawnSync('npm', ['run', 'build'], { cwd: appDir, env: envBuild, stdio: 'inherit' })
  if (build.status !== 0) process.exit(build.status ?? 1)

  if (!existsSync(join(distDir, 'index.html'))) {
    throw new Error('No apareció dist/index.html después del build.')
  }

  output.write('\nSubiendo archivos (incluye .htaccess)…\n')
  const client = new Client(60_000)
  client.ftp.verbose = false
  try {
    await client.access({
      host: ftpHost,
      user: ftpUser,
      password: ftpPass,
      port: 21,
    })
    const destino = await resolverDestino(client, remotoPedido)
    await subirDist(client, destino)
  } finally {
    client.close()
  }

  const urlFinal = /^https?:\/\//i.test(sitio) ? sitio : `https://${sitio}`
  const patronAuth = patronRedirectAuth(urlFinal)
  output.write(`\nListo. Abre ${urlFinal.replace(/\/$/, '')}/#/\n`)
  if (patronAuth) {
    output.write(
      `\nAuth: si este dominio es nuevo, en Supabase → Authentication → URL Configuration\n` +
        `añade Redirect URL:\n  ${patronAuth}\n` +
        `Site URL del proyecto = un origen vuestro (p. ej. el primer salón), nunca GitHub Pages.\n` +
        `Subdominios de un dominio padre: una sola línea https://*.tudominio.com/**\n`,
    )
  }
} catch (err) {
  try {
    rl.close()
  } catch {
    /* ya cerrado */
  }
  console.error(`\nError: ${err.message || err}`)
  process.exit(1)
}
