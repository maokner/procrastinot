import { notFound } from 'next/navigation';
import DemoClient from './DemoClient';

export const metadata = {
  title: 'Plinko demo',
  robots: { index: false, follow: false },
};

export default function PlinkoDemoPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <DemoClient />;
}
