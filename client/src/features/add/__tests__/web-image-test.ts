import { downscaleWebImage } from '../web-image';

const original = 'data:image/png;base64,original';
const compressed = 'data:image/jpeg;base64,compressed';
const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
const fileReaderDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'FileReader');

function setup(width = 4032, height = 3024) {
  const image = { naturalWidth: width, naturalHeight: height, onload: null as (() => void) | null, onerror: null as (() => void) | null };
  Object.defineProperty(image, 'src', { configurable: true, set: () => image.onload?.() });
  const drawImage = jest.fn();
  const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
  const canvas = {
    width: 0, height: 0,
    getContext: jest.fn(() => ({ drawImage })),
    toBlob: jest.fn((callback: BlobCallback) => callback(blob)),
  };
  const createElement = jest.fn((tag: string) => tag === 'img' ? image : canvas);
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement } });
  const reader = {
    result: compressed, onload: null as (() => void) | null, onerror: null as (() => void) | null,
    readAsDataURL: jest.fn((): void => { reader.onload?.(); }),
  };
  Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: jest.fn(() => reader) });
  return { image, canvas, drawImage, blob, reader };
}

afterEach(() => {
  jest.restoreAllMocks();
  if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
  else Reflect.deleteProperty(globalThis, 'document');
  if (fileReaderDescriptor) Object.defineProperty(globalThis, 'FileReader', fileReaderDescriptor);
  else Reflect.deleteProperty(globalThis, 'FileReader');
});

test.each([
  [4032, 3024, 2048, 1536],
  [3024, 4032, 1536, 2048],
  [640, 480, 640, 480],
])('resizes %sx%s without upscaling and encodes JPEG at 0.85', async (width, height, outputWidth, outputHeight) => {
  const { image, canvas, drawImage, blob, reader } = setup(width, height);
  expect(await downscaleWebImage(original)).toBe(compressed);
  expect(canvas.width).toBe(outputWidth);
  expect(canvas.height).toBe(outputHeight);
  expect(drawImage).toHaveBeenCalledWith(image, 0, 0, outputWidth, outputHeight);
  expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85);
  expect(reader.readAsDataURL).toHaveBeenCalledWith(blob);
});

test('keeps the original when image decoding fails', async () => {
  const { image } = setup();
  Object.defineProperty(image, 'src', { set: () => image.onerror?.() });
  expect(await downscaleWebImage(original)).toBe(original);
});

test('keeps the original when canvas throws', async () => {
  const { drawImage } = setup();
  drawImage.mockImplementation(() => { throw new Error('Canvas unavailable'); });
  expect(await downscaleWebImage(original)).toBe(original);
});

test('keeps the original when canvas cannot encode a blob', async () => {
  const { canvas } = setup();
  canvas.toBlob.mockImplementation((callback) => callback(null));
  expect(await downscaleWebImage(original)).toBe(original);
});

test('keeps the original when reading the compressed blob fails', async () => {
  const { reader } = setup();
  reader.readAsDataURL.mockImplementation(() => reader.onerror?.());
  expect(await downscaleWebImage(original)).toBe(original);
});
