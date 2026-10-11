import { z } from "zod";

export const Id = z.uuid();
export const IsoDate = z.iso.date();
export const IsoDateTime = z.iso.datetime({ offset: true });
export const Key = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/);
export const RepoRef = z.string().regex(/^[\w.-]+\/[\w.-]+$/);
