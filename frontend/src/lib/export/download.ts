// Отдать файл браузеру: временная ссылка с download и щелчок по ней. Ссылку на объект освобождаем
// чуть позже — сразу нельзя, иначе медленный браузер не успеет начать сохранение.

export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}
