import type { ReactNode } from 'react'
import { ScrollView, Text as NativeText, View, type StyleProp, type TextStyle } from 'react-native'
import { styles } from './mobile-markdown-styles'
import { withScale } from './mobile-markdown-scale'

const MAX_TABLE_COLUMNS = 8
const MAX_TABLE_ROWS = 40

type Props = {
  headers: string[]
  rows: string[][]
  cellScale: object | null
  truncatedScale: object | null
  renderCell: (text: string, style: StyleProp<TextStyle>, key: number) => ReactNode
}

export function MobileMarkdownTable({
  headers,
  rows,
  cellScale,
  truncatedScale,
  renderCell
}: Props) {
  const visibleHeaders = headers.slice(0, MAX_TABLE_COLUMNS)
  const visibleRows = rows.slice(0, MAX_TABLE_ROWS)
  const hiddenRows = Math.max(0, rows.length - visibleRows.length)
  const hiddenColumns = Math.max(0, headers.length - visibleHeaders.length)
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.table}>
        <View style={styles.tableRow}>
          {visibleHeaders.map((header, i) =>
            renderCell(header, [styles.tableCell, cellScale, styles.tableHeader], i)
          )}
        </View>
        {visibleRows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.tableRow}>
            {visibleHeaders.map((_, i) =>
              renderCell(row[i] ?? '', withScale(styles.tableCell, cellScale), i)
            )}
          </View>
        ))}
        {hiddenRows > 0 || hiddenColumns > 0 ? (
          <NativeText style={withScale(styles.tableTruncated, truncatedScale)}>
            {hiddenRows > 0 ? `${hiddenRows} more rows` : ''}
            {hiddenRows > 0 && hiddenColumns > 0 ? ' · ' : ''}
            {hiddenColumns > 0 ? `${hiddenColumns} more columns` : ''}
          </NativeText>
        ) : null}
      </View>
    </ScrollView>
  )
}
