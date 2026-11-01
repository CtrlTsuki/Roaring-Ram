// Development only (RR_SHOTS=<folder>): drives the real window through its main states and saves
// screenshots, so the interface can be reviewed without clicking through it by hand.
// Actions are aimed only at a test process R.R. starts itself, under a unique name, so nothing
// else on the machine is trimmed or limited. The Roaring is previewed, never run.
import { app, type BrowserWindow } from 'electron'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function runShots(win: BrowserWindow, dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true })
  const shot = async (name: string) => {
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG())
  }
  const js = (code: string) => win.webContents.executeJavaScript(code, true)
  const size = async (w: number, h: number) => {
    win.setContentSize(w, h)
    await wait(900)
  }

  // A copy of node.exe under its own name: the only app these actions will touch.
  const node = execFileSync('where', ['node'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim()
  const hogExe = path.join(os.tmpdir(), 'rr-shots', 'rr-test-hog.exe')
  fs.mkdirSync(path.dirname(hogExe), { recursive: true })
  if (!fs.existsSync(hogExe)) fs.copyFileSync(node, hogExe)
  const hog = spawn(hogExe, [path.join(app.getAppPath(), 'tests/fixtures/hog.cjs')], { stdio: 'pipe' })
  hog.stdin.write('alloc 700\n')

  try {
    await js(`window.rr.setWaterline(${10 * 1024 ** 3})`)
    await size(1440, 900)
    await wait(9000)
    await shot('1-main-1440')
    await size(1100, 820)
    await shot('2-main-1100')
    await size(420, 860)
    await shot('3-main-420')
    await size(1440, 900)

    // Open the test process's drawer through its row, as a person would.
    await js(`[...document.querySelectorAll('.app-name button')].find(b => /rr-test-hog/i.test(b.closest('.app-name').textContent))?.click()`)
    await wait(1500)
    await shot('4-drawer')
    await js(`[...document.querySelectorAll('dialog.drawer button')].find(b => b.textContent.includes('Run Titan'))?.click()`)
    await wait(2500)
    await shot('5-titan-result')

    // A hard cap above what it uses: enforced by Windows, harmless to the test process.
    await js(`(() => {
      const d = document.querySelector('dialog.drawer');
      d.querySelector('input[value="cap"]').click();
      const input = d.querySelector('#seal-size');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(input, '2'); input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    await wait(400)
    await js(`[...document.querySelectorAll('dialog.drawer button')].find(b => /Apply seal|Update seal/.test(b.textContent))?.click()`)
    await wait(2500)
    await js(`document.querySelector('dialog.drawer .dialog-body').scrollTop = 420`)
    await wait(300)
    await shot('6-seal-enforced')

    await js(`document.querySelector('dialog.drawer').dispatchEvent(new Event('cancel', { cancelable: true }))`)
    await wait(600)
    await shot('7-main-after')
    await js(`[...document.querySelectorAll('.titlebar button')].find(b => b.textContent.includes('The Roaring'))?.click()`)
    await wait(1500)
    await shot('8-roaring-preview')
    await js(`document.querySelector('dialog.modal[open]')?.dispatchEvent(new Event('cancel', { cancelable: true }))`)
    await wait(400)
  } finally {
    await js(`window.rr.removeSeal('rr-test-hog.exe')`).catch(() => {})
    hog.kill()
  }
}
