import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const bookings=sqliteTable('bookings',{
 id:text('id').primaryKey(),token:text('token').notNull(),fingerprint:text('fingerprint').notNull(),type:text('type').notNull(),start:integer('start').notNull(),end:integer('end').notNull(),minutes:integer('minutes').notNull(),amount:integer('amount').notNull(),payload:text('payload').notNull(),state:text('state').notNull(),session:text('session'),checkoutUrl:text('checkout_url'),event:text('event'),expires:integer('expires').notNull(),created:integer('created').notNull()
},t=>[index('bookings_state_start').on(t.state,t.start)]);
export const locks=sqliteTable('slot_locks',{slot:integer('slot').primaryKey(),booking:text('booking').notNull().references(()=>bookings.id)},t=>[index('locks_booking').on(t.booking)]);

export const breakdowns=sqliteTable('breakdowns',{
 id:text('id').primaryKey(),token:text('token').notNull(),name:text('name').notNull(),email:text('email').notNull(),player:text('player').notNull(),goals:text('goals').notNull(),footage:text('footage'),fileKey:text('file_key'),uploadId:text('upload_id'),state:text('state').notNull(),callAddon:integer('call_addon').notNull(),amount:integer('amount').notNull(),mode:text('mode').notNull(),session:text('session'),attempt:integer('attempt').notNull().default(0),paidAt:integer('paid_at'),due:text('due'),started:integer('started'),completed:integer('completed'),video:text('video'),priorities:text('priorities'),drills:text('drills'),message:text('message'),callBooking:text('call_booking'),created:integer('created').notNull()
},t=>[index('breakdowns_state_created').on(t.state,t.created)]);
