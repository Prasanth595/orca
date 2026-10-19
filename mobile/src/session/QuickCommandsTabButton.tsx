import { useMobileTheme } from '../theme/use-mobile-theme'
import { View } from 'react-native'
import { SquareChevronRight } from 'lucide-react-native'

import { MobileSessionHeaderIconButton } from './MobileSessionHeaderIconButton'
import { styles } from './mobile-session-styles'

type Props = {
  disabled: boolean
  onPress: () => void
}

export function QuickCommandsTabButton({ disabled, onPress }: Props) {
  useMobileTheme()

  return (
    <>
      <View style={styles.tabActionDivider} />
      <MobileSessionHeaderIconButton
        disabled={disabled}
        onPress={onPress}
        accessibilityLabel="Quick commands"
        icon={SquareChevronRight}
      />
    </>
  )
}
