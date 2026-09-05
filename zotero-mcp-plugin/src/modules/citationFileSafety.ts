const WINDOWS_DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_ABSOLUTE = /^\\\\[^\\/]+[\\/][^\\/]+/;

export function isAbsoluteFilePath(value: string): boolean {
  const path = value.trim();
  return (
    path.startsWith("/") ||
    WINDOWS_DRIVE_ABSOLUTE.test(path) ||
    WINDOWS_UNC_ABSOLUTE.test(path)
  );
}

export function getPathExtension(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

export function assertSafeCitationFilePath(
  value: unknown,
  allowedExtensions: readonly string[],
  label: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty absolute file path`);
  }

  const path = value.trim();
  if (path.includes("\0")) {
    throw new Error(`${label} contains an invalid null byte`);
  }
  if (!isAbsoluteFilePath(path)) {
    throw new Error(`${label} must be an absolute file path`);
  }

  const normalizedExtensions = allowedExtensions.map((extension) =>
    extension.toLowerCase(),
  );
  const extension = getPathExtension(path);
  if (!normalizedExtensions.includes(extension)) {
    throw new Error(
      `${label} must use one of these extensions: ${normalizedExtensions.join(", ")}`,
    );
  }

  return path;
}
