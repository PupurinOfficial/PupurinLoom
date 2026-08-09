import { useStore } from '../store/useStore'

export default function StatusBar() {
  const status = useStore((s) => s.status)
  const activeView = useStore((s) => s.activeView)
  const labels = useStore((s) => s.labels)
  const edges = useStore((s) => s.edges)
  const currentProject = useStore((s) => s.currentProject)
  const dialogueChars = useStore((s) => s.dialogueChars)

  const viewNames: Record<string, string> = {
    home: '主页',
    script: '编辑器',
    characters: '角色',
    resources: '资源管理器',
    variables: '变量',
    package: '打包',
    plugins: '插件',
  }

  return (
    <footer className="flex items-center justify-between h-7 px-3 bg-loom-panel2 border-t border-loom-border text-[11px] font-mono text-loom-muted select-none">
      <div className="flex items-center gap-4">
        <span className="text-loom-accent">● 铃言织机°</span>
        <span>v0.1.0</span>
        {currentProject && <span className="truncate max-w-[180px]">{currentProject.name}</span>}
        <span>当前视图: {viewNames[activeView]}</span>
        {labels.length > 0 && (
          <span>{labels.length} labels / {edges.length} edges / {dialogueChars} 字</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden md:inline text-loom-muted/60">仆仆铃°工作室</span>
        <span>
          backend:{' '}
          {status?.running ? (
            <span className="text-loom-ok">: {status.port}</span>
          ) : (
            <span className="text-loom-err">offline</span>
          )}
        </span>
      </div>
    </footer>
  )
}
