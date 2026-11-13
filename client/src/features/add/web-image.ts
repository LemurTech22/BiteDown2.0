// Data URIs are fetchable by the web upload client and need no object URL cleanup.
export async function downscaleWebImage(uri: string): Promise<string> {
  try {
    const image = document.createElement('img');
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Couldn’t load image.'));
      image.src = uri;
    });
    if (!image.naturalWidth || !image.naturalHeight) return uri;
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) return uri;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) return uri;
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Couldn’t read image.'));
      reader.onerror = () => reject(new Error('Couldn’t read image.'));
      reader.readAsDataURL(blob);
    });
  } catch {
    return uri;
  }
}
