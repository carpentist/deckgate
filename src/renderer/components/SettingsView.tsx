import { Bell, ChevronLeft, Download, Trash2, Volume2, X } from 'lucide-react'
import { useMemo, type JSX, type ReactNode } from 'react'
import {
  isProjectAutoApproved,
  normalizeProjectPath,
} from '@shared/autoApprove'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@shared/types/settings'
import { playSound } from '@renderer/lib/sound'
import { cn } from '@renderer/lib/utils'
import { useWatcherCommands } from '@renderer/hooks/useWatcherCommands'
import { useWatcherStore } from '@renderer/stores/watcher'
import { Button } from './ui/button'
import { Switch } from './ui/switch'

function Section({
  title,
  children,
  note,
}: {
  title: string
  children: ReactNode
  note?: string
}): JSX.Element {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 px-3 py-2">
      <h2 className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{title}</h2>
      <div className="mt-1 divide-y divide-zinc-800/70">{children}</div>
      {note ? <p className="py-1.5 text-[9px] leading-relaxed text-zinc-600">{note}</p> : null}
    </section>
  )
}

function Row({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] text-zinc-200">{label}</p>
        {description ? (
          <p className="mt-0.5 text-[9px] leading-relaxed text-zinc-500">{description}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  )
}

export function SettingsView(): JSX.Element {
  const backToList = useWatcherStore((state) => state.backToList)
  const snapshot = useWatcherStore((state) => state.snapshot)
  const settings = snapshot?.settings ?? DEFAULT_APP_SETTINGS
  const hookStatus = snapshot?.hookStatus
  const { busy, error, clearError, install, uninstall, updateSettings, clearHistory, hideWindow } =
    useWatcherCommands()

  function patch(value: Partial<AppSettings>): void {
    void updateSettings(value)
  }

  const gateMissing = settings.approvalEnabled && !(hookStatus?.gateInstalled ?? false)
  const projects = useMemo(() => {
    const map = new Map<string, { name: string; cwd: string }>()
    for (const session of snapshot?.sessions ?? []) {
      if (!session.cwd) continue
      const key = normalizeProjectPath(session.cwd)
      if (!key || map.has(key)) continue
      map.set(key, { name: session.projectName, cwd: session.cwd })
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [snapshot?.sessions])

  const selectedProjectCount = settings.autoApproveProjects.length

  function toggleProject(cwd: string, checked: boolean): void {
    const key = normalizeProjectPath(cwd)
    const existing = settings.autoApproveProjects
    const next = checked
      ? [...existing.filter((project) => normalizeProjectPath(project) !== key), cwd]
      : existing.filter((project) => normalizeProjectPath(project) !== key)
    patch({ autoApproveProjects: next })
  }

  function linesToArray(value: string): string[] {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  }

  function resetAutoDefaults(): void {
    patch({
      autoApproveAllProjects: false,
      autoApproveProjects: [],
      autoApproveBlockedTools: [...DEFAULT_APP_SETTINGS.autoApproveBlockedTools],
      autoApproveBlockedCommands: [...DEFAULT_APP_SETTINGS.autoApproveBlockedCommands],
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="drag-region flex h-12 shrink-0 items-center gap-1.5 border-b border-zinc-800 px-2">
        <Button size="icon" variant="ghost" className="size-8" onClick={backToList} title="返回列表">
          <ChevronLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-zinc-100">设置</p>
          <p className="text-[10px] text-zinc-500">本地运行 · 仅监控与提醒</p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={() => void hideWindow()}
          title="隐藏到托盘"
        >
          <X className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
        {error ? (
          <div className="flex items-start justify-between gap-2 rounded-lg border border-rose-500/25 bg-rose-500/[0.05] px-2.5 py-2 text-[10px] text-rose-300">
            <span className="break-words">{error}</span>
            <button
              type="button"
              className="shrink-0 text-rose-300/70 hover:text-rose-200"
              onClick={clearError}
            >
              关闭
            </button>
          </div>
        ) : null}

        <Section
          title="监控 Hooks"
          note="安装后需重启已运行的 Claude 会话。卸载只移除本应用添加的条目。"
        >
          <Row
            label="监控状态"
            description={hookStatus?.installed ? 'Hooks 已写入用户设置' : '尚未安装，无法接收新会话事件'}
          >
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px]',
                hookStatus?.installed
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
              )}
            >
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  hookStatus?.installed ? 'bg-emerald-400' : 'bg-amber-400',
                )}
              />
              {hookStatus?.installed ? '已安装' : '未安装'}
            </span>
          </Row>

          {hookStatus?.error ? (
            <p className="py-1.5 text-[9px] leading-relaxed text-rose-300/90">{hookStatus.error}</p>
          ) : null}

          {hookStatus?.installed &&
          ((hookStatus.missingEvents?.length ?? 0) > 0 || hookStatus.outdated) ? (
            <p className="py-1.5 text-[9px] leading-relaxed text-amber-300/90">
              Hooks 需要更新
              {hookStatus.missingEvents?.length
                ? `：缺少 ${hookStatus.missingEvents.join('、')}`
                : '：授权等待配置已升级'}
              。点击“修复 / 更新 Hooks”，然后重启 Claude Code 会话。
            </p>
          ) : null}

          <div className="flex flex-wrap gap-1.5 py-2">
            <Button size="sm" onClick={() => void install()} disabled={busy !== null}>
              <Download className="size-3" />
              {busy === 'install' ? '安装中…' : hookStatus?.installed ? '修复 / 更新 Hooks' : '安装 Hooks'}
            </Button>
            {hookStatus?.installed ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void uninstall()}
                disabled={busy !== null}
              >
                <Trash2 className="size-3" />
                {busy === 'uninstall' ? '卸载中…' : '卸载 Hooks'}
              </Button>
            ) : null}
          </div>

          {gateMissing ? (
            <p className="py-1.5 text-[9px] leading-relaxed text-amber-300/90">
              快速授权门控尚未安装。点击“修复 / 更新 Hooks”并重启会话后生效。
            </p>
          ) : null}
        </Section>

        <Section title="通知">
          <Row label="桌面通知" description="权限、问题、失败等状态变化">
            <Switch
              checked={settings.notificationsEnabled}
              onCheckedChange={(checked) => patch({ notificationsEnabled: checked })}
              label="桌面通知"
            />
          </Row>
          <Row label="等待授权">
            <Switch
              checked={settings.notifyOnPermission}
              onCheckedChange={(checked) => patch({ notifyOnPermission: checked })}
              disabled={!settings.notificationsEnabled}
              label="等待授权通知"
            />
          </Row>
          <Row label="等待回答">
            <Switch
              checked={settings.notifyOnQuestion}
              onCheckedChange={(checked) => patch({ notifyOnQuestion: checked })}
              disabled={!settings.notificationsEnabled}
              label="等待回答通知"
            />
          </Row>
          <Row label="回合完成">
            <Switch
              checked={settings.notifyOnCompletion}
              onCheckedChange={(checked) => patch({ notifyOnCompletion: checked })}
              disabled={!settings.notificationsEnabled}
              label="完成通知"
            />
          </Row>
          <Row label="执行失败">
            <Switch
              checked={settings.notifyOnFailure}
              onCheckedChange={(checked) => patch({ notifyOnFailure: checked })}
              disabled={!settings.notificationsEnabled}
              label="失败通知"
            />
          </Row>
          <Row label="异常退出">
            <Switch
              checked={settings.notifyOnAbnormalExit}
              onCheckedChange={(checked) => patch({ notifyOnAbnormalExit: checked })}
              disabled={!settings.notificationsEnabled}
              label="异常退出通知"
            />
          </Row>
          <Row label="通知冷却" description="同一会话同类提醒的最小间隔">
            <select
              value={settings.notificationCooldownSec}
              onChange={(event) => patch({ notificationCooldownSec: Number(event.target.value) })}
              disabled={!settings.notificationsEnabled}
              className="h-7 rounded-md border border-zinc-800 bg-zinc-900 px-1.5 text-[10px] text-zinc-300 outline-none disabled:opacity-50"
            >
              {[0, 15, 30, 60, 120].map((value) => (
                <option key={value} value={value}>
                  {value === 0 ? '不冷却' : `${value} 秒`}
                </option>
              ))}
            </select>
          </Row>
          <div className="py-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void window.watcher?.testNotification()}
            >
              <Bell className="size-3" />
              测试通知
            </Button>
          </div>
        </Section>

        <Section title="声音">
          <Row label="提醒声音" description="不同事件使用不同提示音">
            <Switch
              checked={settings.soundEnabled}
              onCheckedChange={(checked) => patch({ soundEnabled: checked })}
              label="提醒声音"
            />
          </Row>
          <div className="py-2">
            <Button size="sm" variant="outline" onClick={() => playSound('attention')}>
              <Volume2 className="size-3" />
              测试声音
            </Button>
          </div>
        </Section>

        <Section title="窗口">
          <Row label="窗口置顶" description="始终显示在其他窗口上方">
            <Switch
              checked={settings.alwaysOnTop}
              onCheckedChange={(checked) => patch({ alwaysOnTop: checked })}
              label="窗口置顶"
            />
          </Row>
          <Row label="迷你条模式" description="收起到 380×104 的悬浮条">
            <Switch
              checked={settings.miniMode}
              onCheckedChange={(checked) => patch({ miniMode: checked })}
              label="迷你条模式"
            />
          </Row>
        </Section>

        <Section
          title="快速授权"
          note="开启后，普通工具权限可在本应用点击允许/拒绝。最长等待 10 分钟；超时、应用关闭或遇到提问时回退原终端。"
        >
          <Row label="应用内授权" description="默认关闭；仅对普通工具权限生效">
            <Switch
              checked={settings.approvalEnabled}
              onCheckedChange={(checked) =>
                patch(
                  checked
                    ? { approvalEnabled: true }
                    : { approvalEnabled: false, autoApproveAll: false },
                )
              }
              label="应用内授权"
            />
          </Row>
          <Row
            label="自动授权总开关（高风险）"
            description="只对下方勾选的项目生效；不会修改 .claude 设置"
          >
            <Switch
              checked={settings.autoApproveAll}
              onCheckedChange={(checked) =>
                patch(
                  checked
                    ? { autoApproveAll: true, approvalEnabled: true }
                    : { autoApproveAll: false },
                )
              }
              label="自动授权总开关"
            />
          </Row>
          {settings.autoApproveAll ? (
            <div className="my-1.5 rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-2 py-1.5 text-[9px] leading-relaxed text-rose-200/90">
              自动授权已开启：只对勾选的项目或“所有项目”开关自动放行普通工具权限，不弹卡片；不会写入 Claude 的权限规则。
              危险工具/命令黑名单仍会拦截并转为手动卡片。AskUserQuestion 仍需回原终端。每次自动授权会记录在会话时间线。
            </div>
          ) : (
            <p className="my-1.5 rounded-md border border-zinc-800 bg-zinc-900/40 px-2 py-1.5 text-[9px] leading-relaxed text-zinc-500">
              自动授权总开关关闭时，下面的项目选择、所有项目和黑名单只保存配置，不会生效，控件不可编辑。请先开启总开关。
            </p>
          )}

          <div className="py-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-zinc-300">自动授权项目</p>
              <span className="text-[9px] tabular-nums text-zinc-500">
                {settings.autoApproveAllProjects
                  ? '所有项目'
                  : `已选 ${selectedProjectCount}`}
              </span>
            </div>
            <p className="mt-0.5 text-[9px] leading-relaxed text-zinc-600">
              未勾选的项目仍会弹出手动授权卡片。
            </p>
            {projects.length === 0 ? (
              <p className="mt-1 text-[9px] text-zinc-600">
                启动 Claude Code 会话后，项目会出现在这里。
              </p>
            ) : (
              <div className="mt-1 max-h-40 space-y-1 overflow-y-auto">
                {projects.map((project) => (
                  <div
                    key={project.cwd}
                    className="flex items-center justify-between gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/30 px-2 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[10px] text-zinc-300">{project.name}</p>
                      <p className="truncate text-[9px] text-zinc-600" title={project.cwd}>
                        {project.cwd}
                      </p>
                    </div>
                    <Switch
                      checked={
                        settings.autoApproveAllProjects ||
                        isProjectAutoApproved(project.cwd, settings.autoApproveProjects)
                      }
                      onCheckedChange={(checked) => toggleProject(project.cwd, checked)}
                      disabled={!settings.autoApproveAll || settings.autoApproveAllProjects}
                      label={`自动授权 ${project.name}`}
                    />
                  </div>
                ))}
              </div>
            )}
            {settings.autoApproveAll &&
            !settings.autoApproveAllProjects &&
            selectedProjectCount === 0 ? (
              <p className="mt-1 rounded-md border border-amber-500/25 bg-amber-500/[0.05] px-2 py-1 text-[9px] text-amber-200/90">
                尚未选择项目，自动授权不会生效。
              </p>
            ) : null}
          </div>

          <Row
            label="所有项目（高风险）"
            description="忽略上面的项目列表，对所有项目自动授权；黑名单仍生效"
          >
            <Switch
              checked={settings.autoApproveAllProjects}
              onCheckedChange={(checked) => patch({ autoApproveAllProjects: checked })}
              disabled={!settings.autoApproveAll}
              label="所有项目自动授权"
            />
          </Row>

          <div className="space-y-1 py-1.5">
            <details className="rounded-md border border-zinc-800/70 px-2 py-1.5">
              <summary className="cursor-pointer text-[10px] text-zinc-300">
                危险工具黑名单（{settings.autoApproveBlockedTools.length}）
              </summary>
              <p className="mt-1 text-[9px] leading-relaxed text-zinc-600">
                每行一个工具名。命中后不会自动授权，改为手动卡片。
              </p>
              <textarea
                defaultValue={settings.autoApproveBlockedTools.join('\n')}
                onBlur={(event) =>
                  patch({ autoApproveBlockedTools: linesToArray(event.target.value) })
                }
                rows={3}
                spellCheck={false}
                disabled={!settings.autoApproveAll}
                className={cn(
                  'mt-1 w-full resize-y rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1 font-mono text-[10px] text-zinc-300 outline-none',
                  !settings.autoApproveAll && 'opacity-50',
                )}
              />
            </details>
            <details className="rounded-md border border-zinc-800/70 px-2 py-1.5">
              <summary className="cursor-pointer text-[10px] text-zinc-300">
                危险命令/字符黑名单（{settings.autoApproveBlockedCommands.length}）
              </summary>
              <p className="mt-1 text-[9px] leading-relaxed text-zinc-600">
                每行一个片段。黑名单是安全网，不是绝对防护。
              </p>
              <textarea
                defaultValue={settings.autoApproveBlockedCommands.join('\n')}
                onBlur={(event) =>
                  patch({
                    autoApproveBlockedCommands: linesToArray(event.target.value),
                  })
                }
                rows={6}
                spellCheck={false}
                disabled={!settings.autoApproveAll}
                className={cn(
                  'mt-1 w-full resize-y rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1 font-mono text-[10px] text-zinc-300 outline-none',
                  !settings.autoApproveAll && 'opacity-50',
                )}
              />
            </details>
            <p className="text-[9px] leading-relaxed text-zinc-600">
              黑名单只影响自动授权；未通过黑名单的请求仍可在授权卡片里手动处理。
            </p>
            <div className="flex items-center justify-between gap-2 py-1.5">
              <p className="text-[9px] leading-relaxed text-zinc-600">
                恢复默认值会清空项目选择、关闭“所有项目”，并重置黑名单；不会关闭自动授权总开关。
              </p>
              <Button size="sm" variant="outline" onClick={resetAutoDefaults}>
                恢复默认值
              </Button>
            </div>
          </div>

          <Row label="等待上限">
            <select
              value={settings.approvalWaitSec}
              onChange={(event) => patch({ approvalWaitSec: Number(event.target.value) })}
              disabled={!settings.approvalEnabled}
              className="h-7 rounded-md border border-zinc-800 bg-zinc-900 px-1.5 text-[10px] text-zinc-300 outline-none disabled:opacity-50"
            >
              {[60, 300, 600].map((value) => (
                <option key={value} value={value}>
                  {value / 60} 分钟
                </option>
              ))}
            </select>
          </Row>
          <Row label="请求时显示窗口" description="收到授权请求时自动把窗口带到前台">
            <Switch
              checked={settings.showOnApproval}
              onCheckedChange={(checked) => patch({ showOnApproval: checked })}
              disabled={!settings.approvalEnabled}
              label="授权时显示窗口"
            />
          </Row>
        </Section>

        <Section title="数据与历史" note="历史记录只保存在本机 SQLite 数据库中。">
          <Row label="保留天数" description="超过期限的已完成会话与事件会自动清理">
            <select
              value={settings.historyRetentionDays}
              onChange={(event) => patch({ historyRetentionDays: Number(event.target.value) })}
              className="h-7 rounded-md border border-zinc-800 bg-zinc-900 px-1.5 text-[10px] text-zinc-300 outline-none"
            >
              {[7, 30, 90, 180].map((value) => (
                <option key={value} value={value}>
                  {value} 天
                </option>
              ))}
            </select>
          </Row>
          <div className="py-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void clearHistory()}
              title="清除所有历史会话、事件和通知记录"
            >
              <Trash2 className="size-3" />
              清除历史记录
            </Button>
          </div>
        </Section>

        <Section title="关于">
          <p className="py-2 text-[9px] leading-relaxed text-zinc-500">
            Deckgate 只读取本机事件与进程信息，不联网、不上传命令行内容，也不会自动批准或拒绝权限。
          </p>
          <div className="py-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void window.watcher?.quitApp()}
              title="退出应用并停止监控"
            >
              退出应用
            </Button>
          </div>
        </Section>
      </div>
    </div>
  )
}
