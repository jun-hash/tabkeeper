import { randomBytes } from 'node:crypto'

export type IdFactory = (now: number) => string

/** Short, time-sortable ids that are comfortable to type (`tabkeeper restore m1x9k2-a7f3`). */
export const timeSortableId: IdFactory = (now) => `${now.toString(36)}-${randomBytes(2).toString('hex')}`
