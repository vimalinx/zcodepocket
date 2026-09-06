import { Redirect, type Href } from 'expo-router';
import { useApp } from '@/store/app';

export default function Entry() {
  const hydrated = useApp((s) => s.hydrated);
  const paired = useApp((s) => s.paired);
  if (!hydrated) return null;
  if (paired) return <Redirect href={'/(tabs)/latest' as Href} />;
  return <Redirect href="/pair" />;
}
