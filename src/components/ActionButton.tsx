import type { ComponentProps } from 'react';
import { Button as PaperButton } from 'react-native-paper';

/** Shared comfortable touch target, including compact text actions. */
export function Button({ contentStyle, ...props }: ComponentProps<typeof PaperButton>) {
  return <PaperButton {...props} contentStyle={[{ minHeight: 48 }, contentStyle]} />;
}
