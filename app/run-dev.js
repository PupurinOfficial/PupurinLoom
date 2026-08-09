delete process.env.ELECTRON_RUN_AS_NODE
const { resolve } = require('path')
const vitePath = resolve(__dirname, 'node_modules/electron-vite/bin/electron-vite.js')
process.argv = [process.argv[0], vitePath, 'dev']
import(vitePath).catch((e) => {
  console.error('Failed to start electron-vite:', e)
  process.exit(1)
})
