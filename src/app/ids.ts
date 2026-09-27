import { randomBytes } from 'node:crypto'

export type IdFactory = (now: number) => string

export const timeSortableId: IdFactory = (now) => `${now.toString(36)}-${randomBytes(2).toString('hex')}`
