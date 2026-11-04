/* フォルダを書き込みできる形で選ぶ（File System Access API。Chrome・Edge のみ） */

interface Window {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
}
