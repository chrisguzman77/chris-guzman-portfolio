// Declarative Directus schema for the portfolio content. bootstrap.mjs creates
// whatever is missing and never alters existing collections or fields, so a
// change to an existing field here must also be made by hand in the CMS.

/** Every collection the web app reads; also the Flow's trigger list. */
export const CONTENT_COLLECTIONS = [
  "profile",
  "experience",
  "education",
  "involvement",
  "certifications",
  "projects",
  "posts",
  "resume",
];

export const SINGLETONS = ["profile", "resume"];

const half = { width: "half" };

const status = {
  field: "status",
  type: "string",
  meta: {
    interface: "select-dropdown",
    display: "labels",
    options: {
      choices: [
        { text: "Draft", value: "draft" },
        { text: "Published", value: "published" },
      ],
    },
    width: "half",
  },
  schema: { default_value: "draft", is_nullable: false },
};

const sort = {
  field: "sort",
  type: "integer",
  meta: { interface: "input", hidden: true },
  schema: {},
};

function string(field, { required = false, unique = false, width = "full" } = {}) {
  return {
    field,
    type: "string",
    meta: { interface: "input", required, width },
    schema: { is_nullable: !required, is_unique: unique },
  };
}

function text(field, { required = false, markdown = false } = {}) {
  return {
    field,
    type: "text",
    meta: { interface: markdown ? "input-rich-text-md" : "input-multiline", required },
    schema: { is_nullable: !required },
  };
}

function date(field, { required = false } = {}) {
  return {
    field,
    type: "date",
    meta: { interface: "datetime", required, width: "half" },
    schema: { is_nullable: !required },
  };
}

function boolean(field) {
  return {
    field,
    type: "boolean",
    meta: { interface: "boolean", special: ["cast-boolean"], width: "half" },
    schema: { default_value: false, is_nullable: false },
  };
}

function tags(field) {
  return {
    field,
    type: "json",
    meta: { interface: "tags", special: ["cast-json"] },
    schema: {},
  };
}

function file(field, iface) {
  return {
    field,
    type: "uuid",
    meta: { interface: iface, special: ["file"] },
    schema: {},
  };
}

const degrees = {
  field: "degrees",
  type: "json",
  meta: {
    interface: "list",
    special: ["cast-json"],
    options: {
      template: "{{kind}}: {{name}}",
      fields: [
        {
          field: "kind",
          name: "kind",
          type: "string",
          meta: {
            field: "kind",
            type: "string",
            interface: "select-dropdown",
            width: "half",
            options: {
              choices: [
                { text: "Degree", value: "degree" },
                { text: "Minor", value: "minor" },
              ],
            },
          },
        },
        {
          field: "name",
          name: "name",
          type: "string",
          meta: { field: "name", type: "string", interface: "input", width: "half" },
        },
      ],
    },
  },
  schema: {},
};

const projectType = {
  field: "type",
  type: "string",
  meta: {
    interface: "select-dropdown",
    options: {
      choices: [
        { text: "Personal", value: "personal" },
        { text: "Competition", value: "competition" },
      ],
    },
    width: "half",
  },
  schema: { default_value: "personal", is_nullable: false },
};

export const collections = [
  {
    collection: "profile",
    meta: { singleton: true, icon: "person" },
    fields: [
      string("name", { required: true }),
      text("intro", { required: true }),
      string("email", { required: true, ...half }),
      string("location", { required: true, ...half }),
      string("github_url", { required: true, ...half }),
      string("linkedin_url", { required: true, ...half }),
      text("seo_description", { required: true }),
    ],
  },
  {
    collection: "experience",
    meta: { icon: "work", sort_field: "sort" },
    fields: [
      status,
      sort,
      string("company", { required: true, ...half }),
      string("role", { required: true, ...half }),
      string("location", { required: true, ...half }),
      date("start_date", { required: true }),
      date("end_date"),
      tags("highlights"),
      tags("tech"),
      boolean("show_on_home"),
    ],
  },
  {
    collection: "education",
    meta: { icon: "school", sort_field: "sort" },
    fields: [
      status,
      sort,
      string("school", { required: true }),
      string("location", { required: true, ...half }),
      date("end_date", { required: true }),
      degrees,
      tags("coursework"),
    ],
  },
  {
    collection: "involvement",
    meta: { icon: "groups", sort_field: "sort" },
    fields: [
      status,
      sort,
      string("organization", { required: true, ...half }),
      string("role", { required: true, ...half }),
      string("year", { required: true, ...half }),
      text("summary"),
    ],
  },
  {
    collection: "certifications",
    meta: { icon: "verified", sort_field: "sort" },
    fields: [
      status,
      sort,
      string("name", { required: true, ...half }),
      string("issuer", { required: true, ...half }),
      date("date"),
      string("url", half),
    ],
  },
  {
    collection: "projects",
    meta: { icon: "code", sort_field: "sort" },
    fields: [
      status,
      sort,
      string("slug", { required: true, unique: true, ...half }),
      string("title", { required: true, ...half }),
      text("summary", { required: true }),
      text("body", { markdown: true }),
      projectType,
      string("award", half),
      tags("tech"),
      string("repo_url", half),
      string("live_url", half),
      file("cover", "file-image"),
      date("date"),
      boolean("featured"),
    ],
  },
  {
    collection: "posts",
    meta: { icon: "article" },
    fields: [
      status,
      string("slug", { required: true, unique: true, ...half }),
      string("title", { required: true, ...half }),
      date("published_at", { required: true }),
      text("excerpt", { required: true }),
      text("body", { required: true, markdown: true }),
      tags("tags"),
      file("cover", "file-image"),
    ],
  },
  {
    collection: "resume",
    meta: { singleton: true, icon: "description" },
    fields: [file("file", "file"), string("version_label", half), date("updated_at")],
  },
];
