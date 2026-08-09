import Editor from '@monaco-editor/react'
import { useStore } from '../store/useStore'
import { usePreferences } from '../store/preferences'
import { beforeMount as registerRenpy } from '../monaco-renpy'

export default function CodePanel() {
  const selectedLabelId = useStore((s) => s.selectedLabelId)
  const labels = useStore((s) => s.labels)
  const source = useStore((s) => s.source)
  const themeMode = usePreferences((s) => s.mode)
  const editorFontSize = usePreferences((s) => s.editorFontSize)

  const label = labels.find((l) => l.id === selectedLabelId)
  const code = label ? label.source : source
  const title = label
    ? `label ${label.name}  ·  L${label.line}-${label.end_line}`
    : 'script.rpy  ·  全文'

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-8 bg-loom-panel2 border-b border-loom-border text-xs">
        <span className="text-loom-accent font-mono">{title}</span>
      </div>
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language="renpy"
          theme={themeMode === 'light' ? 'loom-light' : 'loom-dark'}
          beforeMount={registerRenpy}
          value={code}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: editorFontSize,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            fontFamily: 'SF Mono, Menlo, Consolas, monospace',
            renderLineHighlight: 'line',
            padding: { top: 8 }
          }}
        />
      </div>
    </div>
  )
}
