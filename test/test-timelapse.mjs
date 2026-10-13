import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const html = fs.readFileSync('timelapse/index.html', 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0]?.[1];
assert.ok(script, 'Time-lapse page includes its application script');

function createRuntime(options = {}) {
  const clock = { now: 0 };
  const nodes = new Map();
  const recorders = [];
  let rafCount = 0;
  let urlCount = 0;
  const canvas = {
    width: 0,
    height: 0,
    draws: [],
    getContext: () => ({
      fillRect() {},
      drawImage(image) {
        canvas.draws.push({
          image: image.name,
          time: clock.now,
          recording: recorders.at(-1)?.state === 'recording'
        });
      }
    }),
    captureStream: () => ({ getTracks: () => [{ stop() {} }] })
  };

  class Node {
    constructor() {
      this.listeners = new Map();
      this.attributes = new Set();
      this.classList = { add() {}, remove() {} };
      this.style = {};
      this.value = '';
      this.hidden = false;
      this.disabled = false;
      this.textContent = '';
    }
    addEventListener(type, callback, eventOptions = {}) {
      const listeners = this.listeners.get(type) || [];
      listeners.push({ callback, once: eventOptions.once });
      this.listeners.set(type, listeners);
    }
    dispatch(type, event = {}) {
      const listeners = this.listeners.get(type) || [];
      this.listeners.set(type, listeners.filter(listener => !listener.once));
      for (const listener of listeners) listener.callback(event);
    }
    setAttribute(name) { this.attributes.add(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    append() {}
    appendChild() {}
    replaceChildren() {}
  }

  const ids = [
    'imageInput', 'dropZone', 'imageList', 'createButton', 'cancelButton',
    'progressWrap', 'progress', 'progressText', 'progressPercent', 'status',
    'result', 'preview', 'downloadLink', 'fileCount', 'emptyState', 'fps',
    'width', 'height', 'fit', 'format'
  ];
  for (const id of ids) nodes.set(id, new Node());
  nodes.get('fps').value = '10';
  nodes.get('width').value = '320';
  nodes.get('height').value = '240';
  nodes.get('fit').value = 'contain';
  nodes.get('format').value = 'mp4';

  class MockMediaRecorder {
    static isTypeSupported(type) {
      if (options.unsupportedTypes && options.unsupportedTypes.includes(type)) return false;
      return true;
    }
    constructor(stream, settings) {
      this.stream = stream;
      this.settings = settings;
      this.state = 'inactive';
      this.listeners = new Map();
      recorders.push(this);
    }
    addEventListener(type, callback, eventOptions = {}) {
      const listeners = this.listeners.get(type) || [];
      listeners.push({ callback, once: eventOptions.once });
      this.listeners.set(type, listeners);
    }
    dispatch(type, event = {}) {
      const listeners = this.listeners.get(type) || [];
      this.listeners.set(type, listeners.filter(listener => !listener.once));
      for (const listener of listeners) listener.callback(event);
    }
    start() {
      this.state = 'recording';
      this.startedAt = clock.now;
      queueMicrotask(() => {
        if (options.startError) {
          this.dispatch('error', { error: new Error('Encoder failed during startup.') });
        } else if (!options.noStartEvent) {
          this.dispatch('start');
        }
      });
    }
    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      this.stoppedAt = clock.now;
      queueMicrotask(() => {
        this.dispatch('dataavailable', { data: { size: 1 } });
        this.dispatch('stop');
      });
    }
  }

  class MockCanvasElement {}
  MockCanvasElement.prototype.captureStream = () => {};

  const global = {
    Blob,
    MediaRecorder: MockMediaRecorder,
    HTMLCanvasElement: MockCanvasElement,
    document: {
      getElementById: id => nodes.get(id),
      createElement: tag => tag === 'canvas' ? canvas : new Node()
    },
    window: { addEventListener() {} },
    URL: {
      createObjectURL: () => `blob:${++urlCount}`,
      revokeObjectURL() {}
    },
    createImageBitmap: async file => {
      if (file.name === 'second.jpg') clock.now += options.secondImageDecodeDelay || 0;
      return { name: file.name, width: 100, height: 100, close() {} };
    },
    performance: { now: () => clock.now },
    requestAnimationFrame: callback => {
      rafCount++;
      if (options.errorAtRaf === rafCount) {
        queueMicrotask(() => recorders.at(-1).dispatch('error', {
          error: new Error('Encoder failed during rendering.')
        }));
        return rafCount;
      }
      clock.now += options.rafStep || 25;
      queueMicrotask(() => {
        callback(clock.now);
        if (options.cancelAtRaf === rafCount) nodes.get('cancelButton').dispatch('click');
      });
      return rafCount;
    }
  };
  const runtime = new Function('global', `with (global) {
    ${script}
    return { setImages, createVideo };
  }`)(global);
  return { ...runtime, nodes, recorders, clock, canvas };
}

async function within(promise, ms = 500) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Operation did not finish promptly.')), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function addImages(runtime) {
  runtime.setImages([
    { name: 'first.jpg', type: 'image/jpeg' },
    { name: 'second.jpg', type: 'image/jpeg' }
  ]);
}

test('time-lapse frame durations exclude image decoding latency', async () => {
  const runtime = createRuntime({ secondImageDecodeDelay: 500 });
  addImages(runtime);

  await runtime.createVideo();

  const [recorder] = runtime.recorders;
  assert.equal(recorder.startedAt, 500, 'Recording starts after both images have decoded');
  assert.equal(recorder.stoppedAt - recorder.startedAt, 200, 'Two frames at 10 fps take exactly 200 ms');
  assert.deepEqual(
    runtime.canvas.draws.filter(draw => draw.recording && draw.image === 'second.jpg').map(draw => draw.time),
    [600, 625, 650, 675],
    'The second image is rendered at a steady cadence for its full frame interval'
  );
});

test('time-lapse reports recorder startup failures without waiting for a start event', async () => {
  const runtime = createRuntime({ startError: true });
  addImages(runtime);

  await within(runtime.createVideo());

  assert.match(runtime.nodes.get('status').textContent, /Encoder failed during startup/);
});

test('time-lapse stops rendering promptly when the recorder fails', async () => {
  const runtime = createRuntime({ errorAtRaf: 2 });
  addImages(runtime);

  await within(runtime.createVideo());

  assert.match(runtime.nodes.get('status').textContent, /Encoder failed during rendering/);
  assert.ok(runtime.canvas.draws.filter(draw => draw.recording).length <= 2);
});

test('time-lapse cancellation stops recording and reports cancellation', async () => {
  const runtime = createRuntime({ cancelAtRaf: 1 });
  addImages(runtime);

  await runtime.createVideo();

  assert.equal(runtime.nodes.get('status').textContent, 'Time-lapse creation cancelled.');
  assert.equal(runtime.recorders[0].state, 'inactive');
});

test('time-lapse succeeds even when MediaRecorder does not dispatch an early start event', async () => {
  const runtime = createRuntime({ noStartEvent: true });
  addImages(runtime);

  await within(runtime.createVideo());

  assert.match(runtime.nodes.get('status').textContent, /Created 2 frames/);
  assert.equal(runtime.recorders[0].state, 'inactive');
});

test('time-lapse records MP4 when requested and supported', async () => {
  const runtime = createRuntime();
  runtime.nodes.get('format').value = 'mp4';
  addImages(runtime);

  await within(runtime.createVideo());

  const [recorder] = runtime.recorders;
  assert.ok(recorder.settings.mimeType.includes('mp4'), 'Recorder used MP4 mime type');
  assert.equal(runtime.nodes.get('downloadLink').download, 'time-lapse.mp4');
  assert.match(runtime.nodes.get('status').textContent, /MP4/);
});

test('time-lapse records WebM when requested', async () => {
  const runtime = createRuntime();
  runtime.nodes.get('format').value = 'webm';
  addImages(runtime);

  await within(runtime.createVideo());

  const [recorder] = runtime.recorders;
  assert.ok(recorder.settings.mimeType.includes('webm'), 'Recorder used WebM mime type');
  assert.equal(runtime.nodes.get('downloadLink').download, 'time-lapse.webm');
  assert.match(runtime.nodes.get('status').textContent, /WebM/);
});

test('time-lapse falls back to WebM when MP4 is unsupported by browser', async () => {
  const runtime = createRuntime({
    unsupportedTypes: ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4']
  });
  runtime.nodes.get('format').value = 'mp4';
  addImages(runtime);

  await within(runtime.createVideo());

  const [recorder] = runtime.recorders;
  assert.ok(recorder.settings.mimeType.includes('webm'), 'Recorder fell back to WebM');
  assert.equal(runtime.nodes.get('downloadLink').download, 'time-lapse.webm');
});

