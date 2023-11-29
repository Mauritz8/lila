import { objectStorage, ObjectStorage } from 'common/objectStorage';
import { isTouchDevice } from 'common/device';
import { domDialog } from 'common/dialog';

/*
lichess.log('hello', {foo: 'bar'}, 52);     // log stuff
const everything = await lichess.log.get();  // get all log statements
lichess.log.clear();                         // clear idb store
*/

export default function makeLog(): AsyncLog {
  let store: ObjectStorage<string>;
  let resolveReady: () => void;
  let lastKey = Date.now();
  let drift = 0.01;

  const keep = 1000; // recent log statements to keep (roughly), trimmed on startup
  const ready = new Promise<void>(resolve => (resolveReady = resolve));

  objectStorage<string>({ store: 'log' })
    .then(async s => {
      const keys = await s.list();
      if (keys.length > keep) {
        await Promise.all(keys.slice(0, keys.length - keep).map(k => s.remove(k)));
      }
      store = s;
      resolveReady();
    })
    .catch(() => resolveReady());

  async function* getLogs(batchSize = 100) {
    await ready;
    if (!store) return '';
    const keys = await store.list();
    for (let i = 0; i < keys.length; i += batchSize) {
      yield await Promise.all(keys.slice(i, i + batchSize).map(async k => [k, await store.get(k)]));
    }
  }

  function stringify(val: any): string {
    return !val || typeof val === 'string' ? String(val) : JSON.stringify(val);
  }

  const log: any = async (...args: any[]) => {
    console.log(...args);
    await ready;
    let nextKey = Date.now();
    if (nextKey === lastKey) {
      nextKey += drift;
      drift += 0.01;
    } else {
      drift = 0.01;
      lastKey = nextKey;
    }
    const [intPart, fracPart] = String(nextKey).split('.');
    const key = `${intPart.padStart(16, '0')}${fracPart ? '.' + fracPart : ''}`;
    await store?.put(key, args.map(stringify).join(' '));
  };

  log.clear = async () => {
    await ready;
    await store?.clear();
    lastKey = 0;
  };

  log.get = async (): Promise<string> => {
    const logs = [];
    for await (const batch of getLogs()) {
      for (const log of batch) logs.push(`${new Date(parseInt(log[0])).toISOString()} - ${log[1]}`);
    }
    return logs.join('\n');
  };

  log.diagnostic = showDiagnostic;

  return log;
}

async function showDiagnostic() {
  await lichess.loadCssPath('diagnostic');
  const log = await lichess.log();
  const logs = await log.get();
  const text =
    `User Agent: ${navigator.userAgent}\n` +
    `Cores: ${navigator.hardwareConcurrency}\n` +
    `Touch: ${isTouchDevice()} ${navigator.maxTouchPoints}\n` +
    `Screen: ${window.screen.width}x${window.screen.height}\n` +
    `Device Pixel Ratio: ${window.devicePixelRatio}\n` +
    `Language: ${navigator.language}` +
    (logs ? `\n\n${logs}` : '');

  const dlg = await domDialog({
    class: 'diagnostic',
    htmlText:
      `<h2>Diagnostics</h2><pre tabindex="0" class="err">${lichess.escapeHtml(text)}</pre>` +
      (logs ? `<button class="clear button">Clear Logs</button>` : ''),
  });
  const select = () =>
    setTimeout(() => {
      const range = document.createRange();
      range.selectNodeContents(dlg.view.querySelector('.err')!);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }, 0);
  $('.err', dlg.view).on('focus', select);
  $('.clear', dlg.view).on('click', () => log.clear().then(lichess.reload));
  dlg.showModal();
}