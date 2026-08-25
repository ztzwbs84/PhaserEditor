export const GAME_ENTRY = `require('./js/weapp-adapter.js')
GameGlobal.__PHASER_WECHAT_PHASER__ = require('./js/phaser.js')
require('./js/game.bundle.js')
`

export function gameJson(orientation: 'portrait' | 'landscape'): string {
  return json({ deviceOrientation: orientation })
}

export function projectConfig(appid: string, projectName: string): string {
  return json({
    description: 'Generated Phaser 4 WeChat Mini Game project',
    setting: {
      urlCheck: false,
      es6: true,
      postcss: false,
      minified: true,
      newFeature: true,
      compileWorklet: false,
      uploadWithSourceMap: false,
      enhance: false,
      packNpmManually: false,
      packNpmRelationList: [],
      minifyWXSS: true,
      minifyWXML: true,
      localPlugins: false,
      condition: false,
      swc: false,
      disableSWC: true,
      disableUseStrict: false,
      useCompilerPlugins: false
    },
    compileType: 'game',
    libVersion: 'latest',
    appid,
    projectname: projectName,
    condition: {},
    simulatorPluginLibVersion: {},
    packOptions: { ignore: [], include: [] },
    isGameTourist: appid === 'touristappid',
    editorSetting: {}
  })
}

export const OPTIONAL_STORAGE_MODULE = `// Optional template: versioned run-state storage.
const STORAGE_KEY = 'phaser.run-state.v1'

function loadRunState(version) {
  try {
    const value = wx.getStorageSync(STORAGE_KEY)
    if (!value || value.version !== version) return undefined
    return value
  } catch {
    wx.removeStorageSync(STORAGE_KEY)
    return undefined
  }
}

function saveRunState(value) {
  wx.setStorageSync(STORAGE_KEY, value)
}

module.exports = { STORAGE_KEY, loadRunState, saveRunState }
`

export const OPTIONAL_AUDIO_MODULE = `// Optional template: native InnerAudioContext helper.
function createSound(src, loop = false) {
  const sound = wx.createInnerAudioContext()
  sound.src = src
  sound.loop = loop
  return sound
}

module.exports = { createSound }
`

export const OPTIONAL_SPINE_MODULE = `// Optional template: select a static character when Spine is unavailable.
function canUseSpine(scene) {
  return typeof scene?.load?.spineBinary === 'function'
    && typeof scene?.load?.spineAtlas === 'function'
    && typeof scene?.add?.spine === 'function'
}

module.exports = { canUseSpine }
`

export const MANUAL_ACCEPTANCE = [
  'Open this directory in WeChat Developer Tools as a Mini Game project.',
  'Confirm the first scene renders through WebGL without a blank frame.',
  'Confirm touch coordinates match visible game objects on the target device.',
  'Send the app to background and foreground and confirm the game loop resumes.',
  'Confirm local and remote assets load, including names with spaces or non-ASCII characters.',
  'Confirm audio starts only after a user gesture when the source game uses audio.',
  'Confirm Spine content on a real device when the source project includes Spine.'
]

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}
