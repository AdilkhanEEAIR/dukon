// Выгрузка: собрать файл нужного формата и отдать браузеру. Тяжёлые библиотеки (pdfmake, write-excel-file)
// грузятся здесь же лениво — пока никто не нажал «Экспорт», они не скачиваются.

import { saveBlob } from './download'
import { fileName, toCsv, type ExportFormat, type ExportTable } from './table'

export async function buildFile(table: ExportTable, format: ExportFormat): Promise<Blob> {
  if (format === 'csv') return new Blob([toCsv(table)], { type: 'text/csv;charset=utf-8' })
  if (format === 'xlsx') return (await import('./xlsx')).toXlsx(table)
  return (await import('./pdf')).toPdf(table)
}

/** Собирает и сохраняет файл, возвращает его имя — для тоста «Файл готов». */
export async function exportTable(table: ExportTable, format: ExportFormat): Promise<string> {
  const blob = await buildFile(table, format)
  const name = fileName(table, format)
  saveBlob(blob, name)
  return name
}

export type { ExportFormat, ExportTable } from './table'
export { EXPORT_FORMATS } from './table'
export { branchesTable, ordersTable, reportTable, type ExportContext } from './builders'
