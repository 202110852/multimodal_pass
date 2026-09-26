/**
 * 첨부 사진 준비 — 브라우저에서 줄인 뒤 보낸다.
 *
 * 원본(휴대폰 사진 수 MB)을 그대로 보내면 요청이 커지고, 대화 기록(mastra 스키마)에
 * 그대로 남아 매 턴 모델에 다시 들어간다. 긴 변 1024px JPEG 로 줄여 보낸다.
 * 화면·브라우저 보관함에는 더 작은 미리보기(512px)만 둔다 — localStorage 는 5MB 남짓이다.
 * 질문을 고쳐 다시 보낼 때는 그 미리보기를 보낸다.
 */
export const MAX_IMAGES = 3;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const SEND_EDGE = 1024;
const THUMB_EDGE = 512;

export interface Attachment {
  id: string;
  /** 모델에 보낼 사진 (data:image/jpeg;base64,…) */
  send: string;
  /** 화면·보관함용 미리보기 */
  thumb: string;
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* HEIC 등 — 아래 <img> 경로로 (사파리는 여기서 읽는다) */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toJpeg(src: ImageBitmap | HTMLImageElement, edge: number, quality: number): string {
  const w = "naturalWidth" in src ? src.naturalWidth : src.width;
  const h = "naturalHeight" in src ? src.naturalHeight : src.height;
  const scale = Math.min(1, edge / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 를 쓸 수 없습니다");
  // 투명 PNG 가 검게 나오지 않게 흰 바탕
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

export async function prepareImage(file: File): Promise<Attachment> {
  if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) {
    throw new Error("사진 파일만 첨부할 수 있습니다.");
  }
  if (file.size > MAX_SOURCE_BYTES) throw new Error("20MB 보다 큰 사진은 첨부할 수 없습니다.");
  let img: ImageBitmap | HTMLImageElement;
  try {
    img = await decode(file);
  } catch {
    throw new Error("이 브라우저에서 열 수 없는 사진 형식입니다.");
  }
  try {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      send: toJpeg(img, SEND_EDGE, 0.82),
      thumb: toJpeg(img, THUMB_EDGE, 0.72),
    };
  } finally {
    if ("close" in img) img.close();
  }
}

/** "data:image/jpeg;base64,…" → 모델에 보낼 메시지 부분 */
export function imagePart(dataUrl: string) {
  const mime = /^data:([^;]+);/.exec(dataUrl)?.[1] ?? "image/jpeg";
  return { type: "image" as const, image: dataUrl, mimeType: mime };
}
