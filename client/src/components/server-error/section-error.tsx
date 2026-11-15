import { StateView } from '@/components/ui/state-view';

interface SectionErrorProps {
  message: string;
  onRetry: () => void;
  title?: string;
  testID?: string;
}

export function SectionError({ message, onRetry, title = "Couldn't load your food", testID = 'serverError.section.state' }: SectionErrorProps) {
  return <StateView icon="cloud-off-outline" title={title} message={message} testID={testID}
    actionLabel="Try again" actionTestID={`${testID}.retry`} onAction={onRetry} />;
}
