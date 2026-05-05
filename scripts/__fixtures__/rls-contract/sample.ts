// RLS-CONTRACT gate fixture
// This file documents which import patterns trigger and which are ignored by the gate.
// The imports below are deliberately unused — the gate scans for the import lines
// themselves, not for runtime usage. Suppressing no-unused-vars on this fixture only.
/* eslint-disable @typescript-eslint/no-unused-vars */

// SHOULD trigger the gate — value import of `db` outside services
import { db } from '../db/index.js';

// SHOULD NOT trigger the gate — type-only import carries no runtime query risk
import type { db } from '../db/index.js';
