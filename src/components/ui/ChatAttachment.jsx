import { useEffect } from "react";
import { X, File as FileIcon, Download } from "lucide-react";
import ProtectedImage from "./ProtectedImage.jsx";

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|avif|heic|heif)$/i;

/** True for an uploaded_files record (or a picked File) that is a picture. */
export function isImageFile(file) {
  if (!file) return false;
  const mime = String(file.mime_type || file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  return IMAGE_EXT.test(file.original_name || file.name || "");
}

/**
 * A photo inside a chat bubble — shown inline like Messenger (not as a
 * download link). Click it to open the full-size viewer.
 */
export function ChatImage({ file, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen?.(file)}
      title="Open photo"
      className="relative block min-h-[7rem] w-60 max-w-full overflow-hidden rounded-xl bg-slate-200/60"
    >
      <ProtectedImage file={file} alt={file.original_name || "Photo"} className="block h-auto max-h-80 w-full" />
    </button>
  );
}

/** A non-image attachment: the filename as a download chip. */
export function ChatFileChip({ file, mine, onDownload }) {
  return (
    <button
      type="button"
      onClick={() => onDownload(file)}
      className={`mt-1.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition ${
        mine ? "bg-white/15 hover:bg-white/25" : "bg-white hover:bg-slate-50"
      }`}
    >
      <FileIcon size={14} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{file.original_name}</span>
      <Download size={13} className="shrink-0" />
    </button>
  );
}

/**
 * What the sender sees above the message box once they've attached
 * something: a real thumbnail for a photo (so they can check it's the right
 * one before sending), or the filename for any other file.
 * `attachment` = { id, original_name, previewUrl?, mime_type? }
 */
export function PendingAttachment({ attachment, onRemove }) {
  // Free the local preview when it goes away.
  useEffect(() => {
    const url = attachment?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [attachment?.previewUrl]);

  if (!attachment) return null;
  const image = isImageFile(attachment);
  return (
    <div className="mb-2 flex items-center gap-3 rounded-lg bg-slate-50 p-2 text-xs">
      {image && attachment.previewUrl ? (
        <img src={attachment.previewUrl} alt="" className="size-16 shrink-0 rounded-lg border border-slate-200 object-cover" />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white text-slate-400">
          <FileIcon size={16} />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-slate-600">{attachment.original_name}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove attachment"
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-status-danger"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** First pasted/dropped image or file from a clipboard/drag event, if any. */
export function firstFileFrom(dataTransfer) {
  const list = dataTransfer?.files;
  return list && list.length ? list[0] : null;
}
