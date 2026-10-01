import { z } from "zod";

// Directus returns null for empty JSON list fields; normalise to [] at the boundary.
const stringList = z
  .array(z.string())
  .nullable()
  .transform((v) => v ?? []);

export const ProfileSchema = z.object({
  name: z.string(),
  intro: z.string(),
  email: z.string(),
  location: z.string(),
  github_url: z.string().url(),
  linkedin_url: z.string().url(),
  seo_description: z.string(),
});

export const ExperienceSchema = z.object({
  id: z.number(),
  company: z.string(),
  role: z.string(),
  location: z.string(),
  start_date: z.string(),
  end_date: z.string().nullable(),
  highlights: stringList,
  tech: stringList,
  show_on_home: z.boolean(),
});

export const DegreeSchema = z.object({ kind: z.enum(["degree", "minor"]), name: z.string() });

export const EducationSchema = z.object({
  id: z.number(),
  school: z.string(),
  location: z.string(),
  end_date: z.string(),
  degrees: z
    .array(DegreeSchema)
    .nullable()
    .transform((v) => v ?? []),
  coursework: stringList,
});

export const InvolvementSchema = z.object({
  id: z.number(),
  organization: z.string(),
  role: z.string(),
  year: z.string(),
  summary: z.string().nullable(),
});

export const CertificationSchema = z.object({
  id: z.number(),
  name: z.string(),
  issuer: z.string(),
  date: z.string().nullable(),
  url: z.string().nullable(),
});

export const ProjectSchema = z.object({
  id: z.number(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  body: z.string().nullable(),
  type: z.enum(["personal", "competition"]),
  award: z.string().nullable(),
  tech: stringList,
  repo_url: z.string().nullable(),
  live_url: z.string().nullable(),
  cover: z.string().nullable(),
  date: z.string().nullable(),
  featured: z.boolean(),
});

export const PostSchema = z.object({
  id: z.number(),
  slug: z.string(),
  title: z.string(),
  published_at: z.string(),
  excerpt: z.string(),
  body: z.string(),
  tags: stringList,
  cover: z.string().nullable(),
});

export const ResumeSchema = z.object({
  file: z.string().nullable(),
  version_label: z.string().nullable(),
  updated_at: z.string().nullable(),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type Degree = z.infer<typeof DegreeSchema>;
export type Education = z.infer<typeof EducationSchema>;
export type Involvement = z.infer<typeof InvolvementSchema>;
export type Certification = z.infer<typeof CertificationSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Post = z.infer<typeof PostSchema>;
export type Resume = z.infer<typeof ResumeSchema>;
