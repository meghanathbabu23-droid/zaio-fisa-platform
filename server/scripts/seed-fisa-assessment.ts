/**
 * Seed script for the FISA HTML Programmer Qualification Assessment (SP-230372).
 *
 * Creates:
 * 1. FISA Knowledge Assessment (MCQ) — 20 scenario-based questions across HTML5,
 *    semantic markup, forms, tables, CSS selectors, box model, Flexbox, Grid,
 *    responsive design, and Bootstrap 5 components/utilities/breakpoints.
 *    (Duration: 45m | 20 marks | Pass mark: 60% / 12 marks | Auto-marked)
 *
 * 2. FISA Practical Assessment (Coding) — 3 real-world challenges:
 *    - Challenge 1: Semantic HTML webpage with forms and tables (10 marks)
 *    - Challenge 2: Responsive CSS layout using Flexbox/Grid and media queries (10 marks)
 *    - Challenge 3: Responsive Bootstrap 5 website using grid, navbar, cards & utilities (10 marks)
 *    (Duration: 120m | 30 marks | Pass mark: 60% / 18 marks | Auto-assessed + Assessor review)
 *
 * Idempotent: Can be re-run safely without duplicating or modifying existing exams.
 * Preserves the Nov 14 cohort, all student records, and uncommitted changes.
 */

import { ExamType, PracticalTestKind } from "@prisma/client";
import { prisma } from "../src/prisma.js";

export const FISA_MCQ_TITLE =
  "FISA Knowledge Assessment — HTML, CSS & Bootstrap (SP-230372)";

export const FISA_PRACTICAL_TITLE =
  "FISA Practical Assessment — HTML, CSS & Bootstrap (SP-230372)";

export const FISA_MCQ_INSTRUCTIONS =
  "FISA HTML Programmer (SP-230372) Knowledge Assessment.\n" +
  "Total Marks: 20 | Duration: 45 minutes | Pass Mark: 60% (12/20).\n\n" +
  "This assessment contains 20 scenario-based multiple-choice questions covering HTML5 semantics, " +
  "accessible forms, data tables, CSS selectors, box model, Flexbox, CSS Grid, responsive design, " +
  "and Bootstrap 5 components, grid, and utilities.\n" +
  "Each question has four options and exactly one correct answer. Your assessment is automatically marked upon submission.";

export const FISA_PRACTICAL_INSTRUCTIONS =
  "FISA HTML Programmer (SP-230372) Practical Coding Assessment.\n" +
  "Total Marks: 30 | Duration: 120 minutes | Pass Mark: 60% (18/30).\n\n" +
  "OVERVIEW:\n" +
  "Build a complete, professional, responsive web application implementing all three real-world coding challenges in index.html and styles.css using the multi-file editor and live preview.\n\n" +
  "CHALLENGE 1: Semantic HTML Webpage with Forms and Tables (10 marks)\n" +
  "- Structure the webpage using semantic landmarks: <header>, <nav>, <main>, <section>, <article>, and <footer>.\n" +
  "- Include an accessible navigation bar (<nav>) with an unordered list (<ul>, <li>) of navigation links (<a>).\n" +
  "- Build an accessible registration form (<form>) with a <fieldset>, <legend>, associated labels (<label for=\"...\">) and matching input IDs.\n" +
  "- Implement native HTML5 input validation: email input (type=\"email\" required), category select (<select required>), and a mandatory agreement checkbox (type=\"checkbox\" required).\n" +
  "- Construct an accessible data table (<table>) with a <caption>, <thead>, <tbody>, <tfoot>, column headers with scope=\"col\", and at least one cell spanning columns (colspan) or rows (rowspan).\n\n" +
  "CHALLENGE 2: Responsive CSS Layout using Flexbox/Grid and Media Queries (10 marks)\n" +
  "- Apply a universal CSS reset in styles.css: * { box-sizing: border-box; }.\n" +
  "- Style a custom navigation/header bar using Flexbox: display: flex, justify-content (e.g. space-between), align-items (e.g. center), and gap.\n" +
  "- Style a responsive feature or module showcase using CSS Grid: display: grid, grid-template-columns, and gap.\n" +
  "- Implement responsive media queries (@media (max-width: 768px) or @media (min-width: 768px)) to adjust layout across mobile and desktop devices.\n" +
  "- Style cards with custom borders or box-shadow, border-radius, and interactive :hover or :focus transition effects.\n\n" +
  "CHALLENGE 3: Responsive Bootstrap 5 Website with Grid, Navbar, Cards & Utilities (10 marks)\n" +
  "- Link the Bootstrap 5 stylesheet in the <head> of index.html via CDN (https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css).\n" +
  "- Implement a responsive Bootstrap navbar (<nav class=\"navbar navbar-expand-lg ...\">) with .navbar-brand, collapsible nav container, and a toggle button (<button class=\"navbar-toggler\" data-bs-toggle=\"collapse\" data-bs-target=\"#...\">).\n" +
  "- Structure content with Bootstrap 12-column responsive grid: .container or .container-fluid, .row, and responsive column classes (.col-12 .col-md-6 .col-lg-4).\n" +
  "- Build Bootstrap cards (.card) featuring .card-body, .card-title, .card-text, and call-to-action buttons (.btn .btn-primary).\n" +
  "- Leverage Bootstrap utilities for spacing (m-*, p-*), display/flex (d-flex), and alignment.\n\n" +
  "MARKING RUBRIC:\n" +
  "- Challenge 1 (Semantic HTML): 10 test cases × 1 mark = 10 marks\n" +
  "- Challenge 2 (Responsive CSS): 10 test cases × 1 mark = 10 marks\n" +
  "- Challenge 3 (Bootstrap 5): 10 test cases × 1 mark = 10 marks\n" +
  "- Total: 30 marks. Submission is automatically tested and queued for Assessor verification.";

export const FISA_MCQ_QUESTIONS = [
  {
    prompt:
      "A developer is refactoring a legacy company website where all page sections use generic <div> elements. An accessibility audit flags the absence of landmark landmarks for assistive technologies. Which set of semantic HTML5 elements should replace these containers according to W3C standards?",
    options: [
      "<navigation>, <blog>, <bottom>",
      "<nav>, <article>, <footer>",
      "<menu>, <content>, <aside>",
      "<header>, <main-content>, <ending>",
    ],
    correctIndex: 1,
  },
  {
    prompt:
      "A conference registration form requires attendees to enter a valid corporate email address and confirm they accept the terms and conditions checkbox before allowing submission without custom JavaScript. Which HTML5 attributes achieve this native client-side validation?",
    options: [
      'type="email" on the email input, and checked="mandatory" on the checkbox',
      'type="text" pattern="email" and validate="true"',
      'type="email" required on the email input, and required on the checkbox input',
      'inputmode="email" and aria-required="true" on both fields',
    ],
    correctIndex: 2,
  },
  {
    prompt:
      "You are designing a course timetable table displaying module codes, descriptions, and credits. To ensure screen readers announce whether a header cell applies to a column or a row, which attribute and element combination must be used?",
    options: [
      '<td role="header" direction="vertical">',
      '<th scope="col"> for column headers and <th scope="row"> for row headers',
      '<th target="column"> and <th target="row">',
      "<caption> applied to each header cell inside <thead>",
    ],
    correctIndex: 1,
  },
  {
    prompt:
      "An element has the CSS rule: width: 300px; padding: 20px; border: 5px solid #000; margin: 15px;. In standard CSS (box-sizing: content-box), what is the total horizontal space occupied by the element on the page (including margins)?",
    options: ["300px", "350px", "380px", "340px"],
    correctIndex: 2,
  },
  {
    prompt:
      "A styling rule must apply only to paragraphs (<p>) that are direct children of a <section> container, and NOT to paragraphs nested deeper inside an <article> or <div> within that section. Which CSS selector achieves this?",
    options: ["section p", "section > p", "section + p", "section ~ p"],
    correctIndex: 1,
  },
  {
    prompt:
      "When building a landing page with Bootstrap 5, you want cards to occupy full width (12 columns) on mobile viewports, but sit side-by-side in 2 columns (6 columns each) on medium screens (>= 768px) and above. Which class combination should be applied to each column inside a .row?",
    options: [
      "col-xs-12 col-md-6",
      "col-12 col-md-6",
      "col-sm-12 col-lg-2",
      "col-auto col-md-half",
    ],
    correctIndex: 1,
  },
  {
    prompt:
      "A developer places two sibling containers with width: 50% side-by-side. When padding: 10px is added to both, the second container unexpectedly drops onto a new line. Which modern CSS rule prevents padding and borders from expanding the declared width of elements?",
    options: [
      "* { margin: 0; padding: 0; }",
      "* { box-sizing: border-box; }",
      "* { display: inline-flex; }",
      "* { overflow: hidden; }",
    ],
    correctIndex: 1,
  },
  {
    prompt:
      "In a top navigation bar styled with Flexbox (display: flex), the company logo must stay on the far left, while the navigation links and sign-in button align flush to the far right with space between the groups. Which CSS declaration on the flex container accomplishes this without manual margin hacks?",
    options: [
      "align-items: space-between;",
      "justify-content: space-between;",
      "flex-direction: row-reverse;",
      "justify-items: flex-end;",
    ],
    correctIndex: 1,
  },
  {
    prompt:
      "In a dashboard layout styled with CSS Grid (display: grid; grid-template-columns: repeat(4, 1fr);), you need a featured chart component to span across the first 3 columns on the first row. Which CSS property declaration achieves this?",
    options: [
      "grid-column: 1 / span 3;",
      "grid-row: 1 / 3;",
      'grid-template-areas: "chart chart chart";',
      "column-span: 3;",
    ],
    correctIndex: 0,
  },
  {
    prompt:
      "When testing a responsive webpage on a physical mobile phone, the page appears zoomed out and renders at desktop resolution rather than adapting to the device width. Which <meta> tag in the HTML <head> is missing?",
    options: [
      '<meta name="screen" content="mobile-first">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '<meta http-equiv="X-UA-Compatible" content="responsive=true">',
      '<meta name="media-query" content="max-width=768px">',
    ],
    correctIndex: 1,
  },
  {
    prompt:
      'An element has the HTML <button id="submit-btn" class="btn btn-primary">Submit</button>. The stylesheet defines:\n#submit-btn { color: red; }\n.btn-primary { color: blue !important; }\nbutton.btn { color: orange; }\nWhat color will the button text render in the browser?',
    options: [
      "Red (ID selector has higher specificity)",
      "Orange (element plus class combination)",
      "Blue (!important declaration overrides normal specificity)",
      "Green (browser user agent default)",
    ],
    correctIndex: 2,
  },
  {
    prompt:
      "An accessible form contains three related inputs for Date of Birth (Day, Month, Year). Which semantic HTML construct is the W3C recommended pattern to group and label these related form controls for assistive technology?",
    options: [
      'A <div> with title="Date of Birth" containing three <label> elements',
      "A <fieldset> element enclosing the inputs with a child <legend>Date of Birth</legend>",
      'A <section> with aria-label="Date of Birth" and no label tags',
      '<optgroup label="Date of Birth"> wrapping the text inputs',
    ],
    correctIndex: 1,
  },
  {
    prompt:
      "You are implementing a responsive Bootstrap 5 navbar. On mobile devices, the navigation links collapse behind a hamburger button. Which pair of attributes must be applied to the <button class=\"navbar-toggler\"> to toggle the collapse container with id=\"mainNav\" in Bootstrap 5?",
    options: [
      'data-toggle="collapse" and data-target="#mainNav"',
      'data-bs-toggle="collapse" and data-bs-target="#mainNav"',
      'data-collapse="true" and data-nav-id="mainNav"',
      'data-bs-trigger="toggle" and href="#mainNav"',
    ],
    correctIndex: 1,
  },
  {
    prompt:
      "A developer needs to center a card horizontally, add a bottom margin of spacer 4 (1.5rem), apply vertical padding of spacer 3 (1rem), and set a white background with a subtle shadow, strictly using Bootstrap 5 utility classes. Which class list achieves this?",
    options: [
      "mx-auto mb-4 py-3 bg-white shadow-sm",
      "center-x margin-b-4 padding-y-3 bg-light drop-shadow",
      "align-center m-bottom-4 p-vertical-3 bg-white shadow",
      "justify-center mb-4 p-3 bg-white elevation-1",
    ],
    correctIndex: 0,
  },
  {
    prompt:
      "A stylesheet follows the Mobile-First methodology. Base styles apply to mobile viewports, and two media queries are defined:\n@media (min-width: 768px) { ... }\n@media (min-width: 1200px) { ... }\nOn a tablet screen with a viewport width of 1024px, which rules will apply?",
    options: [
      "Only the @media (min-width: 1200px) rules",
      "Base styles and @media (min-width: 768px) rules only",
      "Base styles and @media (min-width: 1200px) rules only",
      "Only the base styles; media queries are ignored until 1200px",
    ],
    correctIndex: 1,
  },
  {
    prompt:
      "A flex container with width: 600px has display: flex; gap: 0;. It contains Item A (flex: 1 1 400px;) and Item B (flex: 1 2 400px;). The total basis is 800px, causing a 200px negative overflow. How does the CSS flex-shrink algorithm distribute this reduction?",
    options: [
      "Both items shrink by exactly 100px equally, resulting in 300px each",
      "Item A shrinks by 66.7px (to ~333.3px) and Item B shrinks by 133.3px (to ~266.7px)",
      "Item B shrinks down to 0px first before Item A shrinks",
      "Neither item shrinks because flex-basis takes absolute precedence over flex-shrink",
    ],
    correctIndex: 1,
  },
  {
    prompt:
      "You are styling an e-commerce card grid where cards automatically wrap into multiple columns without explicit media queries. Each column must be at least 280px wide and expand equally to fill any remaining horizontal row space. Which CSS Grid declaration achieves this responsive pattern?",
    options: [
      "grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));",
      "grid-template-columns: repeat(auto-fill, 280px);",
      "grid-template-columns: auto-flow dense minmax(280px, 100%);",
      "grid-columns: responsive 280px to 1fr;",
    ],
    correctIndex: 0,
  },
  {
    prompt:
      "In a data table, you want to apply zebra striping to every even row starting from row 2, but exclude any rows that possess the class .deleted or .archived. Which CSS selector correctly combines pseudo-classes for this requirement?",
    options: [
      "tr:nth-child(even):not(.deleted, .archived)",
      "tr:nth-child(2n + 1):exclude(.deleted, .archived)",
      "tr:even:without(.deleted):without(.archived)",
      "tr:nth-of-type(odd):not(.deleted):not(.archived)",
    ],
    correctIndex: 0,
  },
  {
    prompt:
      "In a 3-column Bootstrap 5 card layout (.row > .col-md-4), the card text lengths differ across cards, causing the action buttons at the bottom to misalign. What is the standard Bootstrap 5 flexbox solution to force cards to equal height and push buttons flush to the bottom?",
    options: [
      "Apply position: absolute; bottom: 0; to all .btn elements",
      "Add .h-100 to .card, make .card-body a flex column (d-flex flex-column), and add mt-auto to the button wrapper",
      "Add overflow: hidden; max-height: 250px; to all .card-text elements",
      "Add .row-cols-equal to the parent row and remove .card-body",
    ],
    correctIndex: 1,
  },
  {
    prompt:
      "A developer is structuring a blog post page containing the main article, author bio, a list of related articles, and a sidebar with trending topics. Which semantic hierarchy adheres to HTML5 specifications and screen reader accessibility guidelines?",
    options: [
      "Wrap everything in <section>, use <header> for paragraphs, and place the sidebar in <footer>",
      "Use <main> for primary content enclosing <article>; author info inside <article>; trending topics in an independent <aside>",
      "Enclose the entire page in <aside>, and use multiple <main> elements on the page",
      'Use generic <div> containers with role="presentation" and rely solely on aria-hidden',
    ],
    correctIndex: 1,
  },
];

export const FISA_PRACTICAL_TESTS = [
  // --- Challenge 1: Semantic HTML Webpage with Forms and Tables (10 marks) ---
  {
    label: "C1.1: Document landmark structure with <main> element",
    kind: PracticalTestKind.HTML_SELECTOR,
    targetFile: "index.html",
    expression: "main",
    points: 1,
    sortOrder: 0,
  },
  {
    label: "C1.2: Semantic navigation <nav> with link list (ul > li > a)",
    kind: PracticalTestKind.HTML_SELECTOR,
    targetFile: "index.html",
    expression: "nav ul li a",
    points: 1,
    sortOrder: 1,
  },
  {
    label: "C1.3: Content sections or articles (<section> or <article>)",
    kind: PracticalTestKind.HTML_SELECTOR,
    targetFile: "index.html",
    expression: "section, article",
    points: 1,
    sortOrder: 2,
  },
  {
    label: "C1.4: Accessible registration form with <fieldset> and <legend>",
    kind: PracticalTestKind.HTML_SELECTOR,
    targetFile: "index.html",
    expression: "form fieldset legend",
    points: 1,
    sortOrder: 3,
  },
  {
    label: "C1.5: Accessible form input with associated label (<label for=...>)",
    kind: PracticalTestKind.HTML_SELECTOR,
    targetFile: "index.html",
    expression: "label[for]",
    points: 1,
    sortOrder: 4,
  },
  {
    label: "C1.6: Validated required email input (type='email' required)",
    kind: PracticalTestKind.HTML_SELECTOR,
    targetFile: "index.html",
    expression: 'input[type="email"][required]',
    points: 1,
    sortOrder: 5,
  },
  {
    label: "C1.7: Required course selection dropdown (<select required>)",
    kind: PracticalTestKind.HTML_SELECTOR,
    targetFile: "index.html",
    expression: "select[required] option",
    points: 1,
    sortOrder: 6,
  },
  {
    label: "C1.8: Mandatory terms acceptance checkbox (type='checkbox' required)",
    kind: PracticalTestKind.HTML_SELECTOR,
    targetFile: "index.html",
    expression: 'input[type="checkbox"][required]',
    points: 1,
    sortOrder: 7,
  },
  {
    label: "C1.9: Accessible table with caption and <thead> headers",
    kind: PracticalTestKind.HTML_SELECTOR,
    targetFile: "index.html",
    expression: "table caption, table thead th",
    points: 1,
    sortOrder: 8,
  },
  {
    label: "C1.10: Table header scope attribute or column spanning",
    kind: PracticalTestKind.FILE_REGEX,
    targetFile: "index.html",
    expression: '(scope="(col|row)"|colspan="\\d+")',
    points: 1,
    sortOrder: 9,
  },

  // --- Challenge 2: Responsive CSS Layout using Flexbox/Grid and Media Queries (10 marks) ---
  {
    label: "C2.1: Universal box-sizing border-box reset",
    kind: PracticalTestKind.CSS_CONTAINS,
    targetFile: "styles.css",
    expression: "box-sizing: border-box",
    points: 1,
    sortOrder: 10,
  },
  {
    label: "C2.2: Flexbox layout declaration on container (display: flex)",
    kind: PracticalTestKind.CSS_CONTAINS,
    targetFile: "styles.css",
    expression: "display: flex",
    points: 1,
    sortOrder: 11,
  },
  {
    label: "C2.3: Flexbox horizontal alignment (justify-content)",
    kind: PracticalTestKind.FILE_REGEX,
    targetFile: "styles.css",
    expression: "justify-content:\\s*(space-between|center|space-around|space-evenly|flex-start|flex-end)",
    points: 1,
    sortOrder: 12,
  },
  {
    label: "C2.4: Flexbox vertical alignment (align-items)",
    kind: PracticalTestKind.FILE_REGEX,
    targetFile: "styles.css",
    expression: "align-items:\\s*(center|flex-start|flex-end|stretch|baseline)",
    points: 1,
    sortOrder: 13,
  },
  {
    label: "C2.5: Flexbox or grid gap spacing property",
    kind: PracticalTestKind.FILE_REGEX,
    targetFile: "styles.css",
    expression: "gap:\\s*[\\d.]+(rem|px|em)",
    points: 1,
    sortOrder: 14,
  },
  {
    label: "C2.6: CSS Grid container declaration (display: grid)",
    kind: PracticalTestKind.CSS_CONTAINS,
    targetFile: "styles.css",
    expression: "display: grid",
    points: 1,
    sortOrder: 15,
  },
  {
    label: "C2.7: CSS Grid template column layout (grid-template-columns)",
    kind: PracticalTestKind.FILE_REGEX,
    targetFile: "styles.css",
    expression: "grid-template-columns:\\s*",
    points: 1,
    sortOrder: 16,
  },
  {
    label: "C2.8: Responsive media query declaration (@media)",
    kind: PracticalTestKind.FILE_REGEX,
    targetFile: "styles.css",
    expression: "@media\\s*\\((min-width|max-width):",
    points: 1,
    sortOrder: 17,
  },
  {
    label: "C2.9: Card/Component custom styling (border-radius or box-shadow)",
    kind: PracticalTestKind.FILE_REGEX,
    targetFile: "styles.css",
    expression: "(border-radius|box-shadow):",
    points: 1,
    sortOrder: 18,
  },
  {
    label: "C2.10: Interactive hover or focus transitions (:hover or :focus)",
    kind: PracticalTestKind.FILE_REGEX,
    targetFile: "styles.css",
    expression: ":(hover|focus|focus-visible)",
    points: 1,
    sortOrder: 19,
  },

  // --- Challenge 3: Responsive Bootstrap 5 Website with Grid, Navbar, Cards & Utilities (10 marks) ---
  {
    label: "C3.1: Bootstrap 5 stylesheet linked in <head>",
    kind: PracticalTestKind.FILE_REGEX,
    targetFile: "index.html",
    expression: 'href="[^"]*bootstrap(@5|\\.min\\.css)[^"]*"',
    points: 1,
    sortOrder: 20,
  },
  {
    label: "C3.2: Bootstrap responsive navbar element (nav.navbar)",
    kind: PracticalTestKind.HTML_SELECTOR,
    targetFile: "index.html",
    expression: "nav.navbar",
    points: 1,
    sortOrder: 21,
  },
  {
    label: "C3.3: Bootstrap navbar responsive expand class (.navbar-expand-*)",
    kind: PracticalTestKind.HTML_SELECTOR,
    targetFile: "index.html",
    expression: ".navbar-expand-lg, .navbar-expand-md, .navbar-expand-sm",
    points: 1,
    sortOrder: 22,
  },
  {
    label: "C3.4: Bootstrap navbar brand and nav links (.navbar-brand, .nav-link)",
    kind: PracticalTestKind.HTML_SELECTOR,
    targetFile: "index.html",
    expression: ".navbar-brand, .navbar-nav .nav-link",
    points: 1,
    sortOrder: 23,
  },
  {
    label: "C3.5: Bootstrap navbar-toggler with data-bs-toggle='collapse'",
    kind: PracticalTestKind.HTML_SELECTOR,
    targetFile: "index.html",
    expression: 'button.navbar-toggler[data-bs-toggle="collapse"]',
    points: 1,
    sortOrder: 24,
  },
  {
    label: "C3.6: Bootstrap grid container (.container or .container-fluid)",
    kind: PracticalTestKind.HTML_SELECTOR,
    targetFile: "index.html",
    expression: ".container, .container-fluid",
    points: 1,
    sortOrder: 25,
  },
  {
    label: "C3.7: Bootstrap grid row and responsive columns (.row [class*='col-'])",
    kind: PracticalTestKind.HTML_SELECTOR,
    targetFile: "index.html",
    expression: '.row [class*="col-"]',
    points: 1,
    sortOrder: 26,
  },
  {
    label: "C3.8: Bootstrap card component with .card-body",
    kind: PracticalTestKind.HTML_SELECTOR,
    targetFile: "index.html",
    expression: ".card .card-body",
    points: 1,
    sortOrder: 27,
  },
  {
    label: "C3.9: Bootstrap button component inside card (.card .btn)",
    kind: PracticalTestKind.HTML_SELECTOR,
    targetFile: "index.html",
    expression: ".card .btn",
    points: 1,
    sortOrder: 28,
  },
  {
    label: "C3.10: Bootstrap spacing and utility classes (m-*, p-*, d-flex)",
    kind: PracticalTestKind.FILE_REGEX,
    targetFile: "index.html",
    expression: 'class="[^"]*\\b(m[btyxse]?-[0-5]|p[btyxse]?-[0-5]|d-flex|text-center|shadow-sm)\\b[^"]*"',
    points: 1,
    sortOrder: 29,
  },
];

export async function findOrCreateFisaMcqExam() {
  let exam = await prisma.exam.findFirst({
    where: { title: FISA_MCQ_TITLE },
    include: { questions: { orderBy: { sortOrder: "asc" } } },
  });

  if (!exam) {
    exam = await prisma.exam.create({
      data: {
        title: FISA_MCQ_TITLE,
        type: ExamType.MCQ,
        durationMinutes: 45,
        instructions: FISA_MCQ_INSTRUCTIONS,
        cohortId: null,
        questions: {
          create: FISA_MCQ_QUESTIONS.map((q, i) => ({
            prompt: q.prompt,
            options: JSON.stringify(q.options),
            correctIndex: q.correctIndex,
            sortOrder: i,
          })),
        },
      },
      include: { questions: { orderBy: { sortOrder: "asc" } } },
    });
  } else {
    // Keep questions up to date
    await prisma.$transaction(async (tx) => {
      await tx.exam.update({
        where: { id: exam!.id },
        data: {
          durationMinutes: 45,
          instructions: FISA_MCQ_INSTRUCTIONS,
        },
      });
      await tx.mcqQuestion.deleteMany({ where: { examId: exam!.id } });
      await tx.mcqQuestion.createMany({
        data: FISA_MCQ_QUESTIONS.map((q, i) => ({
          examId: exam!.id,
          prompt: q.prompt,
          options: JSON.stringify(q.options),
          correctIndex: q.correctIndex,
          sortOrder: i,
        })),
      });
    });
    exam = await prisma.exam.findUniqueOrThrow({
      where: { id: exam.id },
      include: { questions: { orderBy: { sortOrder: "asc" } } },
    });
  }

  return exam;
}

export async function findOrCreateFisaPracticalExam() {
  let exam = await prisma.exam.findFirst({
    where: { title: FISA_PRACTICAL_TITLE },
    include: { practicalTests: { orderBy: { sortOrder: "asc" } } },
  });

  if (!exam) {
    exam = await prisma.exam.create({
      data: {
        title: FISA_PRACTICAL_TITLE,
        type: ExamType.PRACTICAL,
        durationMinutes: 120,
        instructions: FISA_PRACTICAL_INSTRUCTIONS,
        cohortId: null,
        practicalTests: {
          create: FISA_PRACTICAL_TESTS.map((t) => ({
            label: t.label,
            kind: t.kind,
            targetFile: t.targetFile,
            expression: t.expression,
            points: t.points,
            sortOrder: t.sortOrder,
          })),
        },
      },
      include: { practicalTests: { orderBy: { sortOrder: "asc" } } },
    });
  } else {
    await prisma.$transaction(async (tx) => {
      await tx.exam.update({
        where: { id: exam!.id },
        data: {
          durationMinutes: 120,
          instructions: FISA_PRACTICAL_INSTRUCTIONS,
        },
      });
      await tx.practicalTestCase.deleteMany({ where: { examId: exam!.id } });
      await tx.practicalTestCase.createMany({
        data: FISA_PRACTICAL_TESTS.map((t) => ({
          examId: exam!.id,
          label: t.label,
          kind: t.kind,
          targetFile: t.targetFile,
          expression: t.expression,
          points: t.points,
          sortOrder: t.sortOrder,
        })),
      });
    });
    exam = await prisma.exam.findUniqueOrThrow({
      where: { id: exam.id },
      include: { practicalTests: { orderBy: { sortOrder: "asc" } } },
    });
  }

  return exam;
}

export async function seedFisaAssessment() {
  const mcq = await findOrCreateFisaMcqExam();
  const practical = await findOrCreateFisaPracticalExam();

  return {
    qualification: "FISA HTML Programmer Skills Programme (SP-230372)",
    mcqExam: {
      id: mcq.id,
      title: mcq.title,
      type: mcq.type,
      durationMinutes: mcq.durationMinutes,
      totalQuestions: mcq.questions.length,
      totalMarks: mcq.questions.length,
      passPercentage: "60%",
      passMarks: Math.ceil(mcq.questions.length * 0.6),
    },
    practicalExam: {
      id: practical.id,
      title: practical.title,
      type: practical.type,
      durationMinutes: practical.durationMinutes,
      totalTests: practical.practicalTests.length,
      totalMarks: practical.practicalTests.reduce((sum, t) => sum + t.points, 0),
      passPercentage: "60%",
      passMarks: Math.ceil(
        practical.practicalTests.reduce((sum, t) => sum + t.points, 0) * 0.6
      ),
    },
  };
}

async function main() {
  console.log("Seeding FISA HTML Programmer Assessment (SP-230372)...");
  const summary = await seedFisaAssessment();
  console.log(JSON.stringify(summary, null, 2));
}

// Only run main() if directly executed
if (process.argv[1]?.endsWith("seed-fisa-assessment.ts")) {
  main()
    .catch((err) => {
      console.error("Failed to seed FISA assessment:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

