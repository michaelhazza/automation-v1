// RLS-CONTRACT gate fixture
// This file documents which import patterns trigger and which are ignored by the gate.

// SHOULD trigger the gate — value import of `db` outside services
import { db } from '../db/index.js';

// SHOULD NOT trigger the gate — type-only import carries no runtime query risk
import type { db } from '../db/index.js';
