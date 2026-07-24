const path = require('node:path')
const { pathToFileURL } = require('node:url')

let pluginModule

async function activate() {
  const pluginPath = process.env.PHASER_EDITOR_PLUGIN_PATH
  const main = process.env.PHASER_EDITOR_PLUGIN_MAIN
  if (!pluginPath || !main) throw new Error('Plugin host configuration is incomplete.')
  const entry = path.resolve(pluginPath, main)
  if (!entry.startsWith(path.resolve(pluginPath) + path.sep)) throw new Error('Plugin entry is outside the plugin folder.')
  pluginModule = await import(pathToFileURL(entry).href)
  const context = {
    pluginPath,
    subscriptions: [],
    postMessage(message) {
      process.parentPort.postMessage({ type: 'plugin-message', message })
    }
  }
  if (typeof pluginModule.activate === 'function') await pluginModule.activate(context)
  process.parentPort.postMessage({ type: 'activated' })
}

process.parentPort.on('message', async (event) => {
  if (event.data?.type === 'deactivate' && typeof pluginModule?.deactivate === 'function') {
    await pluginModule.deactivate()
  }
})

activate().catch((error) => {
  process.parentPort.postMessage({ type: 'error', message: error?.stack || String(error) })
  process.exitCode = 1
})
