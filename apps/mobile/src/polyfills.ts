// Must be imported before anything that touches crypto or Buffer.
import 'react-native-get-random-values'; // crypto.getRandomValues backed by the OS CSPRNG
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (!g.Buffer) g.Buffer = Buffer;
