// Rule-based resume analyzer for TarboroJobs Resume Checker.
//
// Inputs:
//   - resumeText: string extracted from the uploaded PDF
//   - options.targetJobTitle: optional user-provided role they're aiming for
//   - options.jobDescription: optional pasted JD text
//
// Output:
//   - A structured report with overallScore (0-100), label, strengths,
//     problems, atsRisks, keywordFeedback, rewriteExamples, nextSteps.
//   - A preview() helper trims that to the free-tier shape.
//
// Scoring is split across six axes, max 100 points:
//   ATS readability       20
//   Keyword / job match   25
//   Experience relevance  20
//   Formatting/structure  15
//   Grammar / clarity     10
//   Required sections     10
//
// All checks are intentionally conservative — we'd rather under-credit a
// resume than over-credit one. This is feedback, not a hiring decision.

const STOPWORDS = new Set([
  'a', 'an', 'and', 'or', 'the', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
  'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
  'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those',
  'it', 'its', 'they', 'them', 'their', 'we', 'our', 'us', 'you', 'your',
  'i', 'me', 'my', 'he', 'she', 'his', 'her', 'who', 'whom', 'which',
  'what', 'when', 'where', 'why', 'how', 'all', 'any', 'some', 'no', 'not',
  'than', 'then', 'so', 'if', 'about', 'into', 'over', 'under', 'between',
  'through', 'during', 'before', 'after', 'above', 'below', 'up', 'down',
  'out', 'off', 'again', 'further', 'here', 'there', 'each', 'few', 'more',
  'most', 'other', 'such', 'only', 'own', 'same', 'too', 'very', 'just',
  'also', 'etc', 'including', 'include', 'includes', 'use', 'using', 'used',
])

// Generic role-to-keywords dictionary used when no JD is provided. Each key
// is a substring matched against the user's target job title (lowercase).
// Order matters - we use the first match. Kept intentionally small/local.
const ROLE_KEYWORDS = [
  {
    match: ['it support', 'help desk', 'helpdesk', 'desktop support', 'computer technician'],
    keywords: [
      'troubleshooting', 'windows', 'hardware', 'software', 'network', 'networking',
      'customer service', 'tickets', 'ticketing', 'active directory', 'printer',
      'remote support', 'imaging', 'office 365',
    ],
  },
  {
    match: ['line cook', 'prep cook', 'cook', 'kitchen', 'chef'],
    keywords: [
      'food prep', 'kitchen', 'grill', 'fryer', 'sanitation', 'inventory',
      'cleaning', 'orders', 'customer service', 'food safety', 'serv safe',
    ],
  },
  {
    match: ['server', 'waiter', 'waitress', 'bartender'],
    keywords: [
      'customer service', 'cash handling', 'pos', 'menu', 'orders', 'tips',
      'cleaning', 'sanitation', 'multitask', 'food safety',
    ],
  },
  {
    match: ['cashier', 'retail', 'sales associate'],
    keywords: [
      'cash handling', 'customer service', 'pos', 'inventory', 'returns',
      'stocking', 'register', 'merchandising', 'sales',
    ],
  },
  {
    match: ['cdl', 'truck driver', 'driver', 'delivery'],
    keywords: [
      'cdl', 'dot', 'route', 'logbook', 'inspection', 'delivery',
      'customer service', 'loading', 'safety', 'navigation',
    ],
  },
  {
    match: ['warehouse', 'forklift', 'shipping', 'receiving'],
    keywords: [
      'forklift', 'pallet', 'inventory', 'shipping', 'receiving',
      'osha', 'safety', 'scanning', 'loading', 'packing',
    ],
  },
  {
    match: ['cna', 'caregiver', 'home health', 'nursing assistant'],
    keywords: [
      'patient care', 'vital signs', 'adl', 'hipaa', 'mobility',
      'feeding', 'hygiene', 'documentation', 'transfer', 'compassion',
    ],
  },
  {
    match: ['administrative', 'admin assistant', 'office assistant', 'receptionist', 'clerk'],
    keywords: [
      'scheduling', 'phones', 'filing', 'data entry', 'microsoft office',
      'excel', 'word', 'customer service', 'correspondence', 'records',
    ],
  },
  {
    match: ['teacher', 'tutor', 'instructor', 'educator'],
    keywords: [
      'curriculum', 'lesson plans', 'classroom', 'assessment', 'parents',
      'students', 'differentiation', 'communication', 'planning',
    ],
  },
  {
    match: ['mechanic', 'technician', 'automotive'],
    keywords: [
      'diagnostic', 'repair', 'maintenance', 'inspection', 'brakes',
      'engine', 'tools', 'customer service', 'safety',
    ],
  },
]

const STRONG_ACTION_VERBS = [
  'led', 'managed', 'built', 'launched', 'created', 'designed', 'developed',
  'increased', 'reduced', 'improved', 'delivered', 'shipped', 'owned',
  'streamlined', 'organized', 'trained', 'mentored', 'resolved', 'implemented',
  'supervised', 'handled', 'coordinated', 'operated', 'maintained', 'achieved',
  'negotiated', 'analyzed', 'researched', 'supported', 'directed',
]

const WEAK_PHRASES = [
  'responsible for', 'duties included', 'helped with', 'worked on',
  'assisted with', 'in charge of', 'tasked with', 'did various', 'various tasks',
]

const SECTION_HEADERS = {
  summary: ['summary', 'objective', 'profile', 'professional summary', 'about'],
  skills: ['skills', 'technical skills', 'core competencies', 'key skills', 'expertise'],
  experience: ['experience', 'work experience', 'employment', 'work history', 'professional experience'],
  education: ['education', 'academic', 'academics'],
  certifications: ['certifications', 'certificates', 'licenses', 'licensure'],
}

const EMAIL_REGEX = /[\w.+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i
const PHONE_REGEX = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/
const BULLET_REGEX = /(^|\n)\s*([•●◦∙\-\*•])\s+\S/
const MEASURABLE_REGEX = /\b(\$?\d+(?:[.,]\d+)?(?:%|k|m|hours?|days?|weeks?|months?|years?|customers?|tickets?|orders?|projects?|people|team\s+of\s+\d+)?)\b/i

function normalizeText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function lower(text) {
  return String(text || '').toLowerCase()
}

function clampScore(value, max) {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > max) return max
  return Math.round(value)
}

function tokenize(text) {
  return lower(text)
    .replace(/[^a-z0-9+#./\s-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token && token.length > 1 && !STOPWORDS.has(token))
}

function hasAnyHeader(lowerText, candidates) {
  return candidates.some((header) => {
    const re = new RegExp(`(^|\\n)\\s*${header.replace(/\s+/g, '\\s+')}\\s*[:\\n]`, 'i')
    return re.test(lowerText)
  })
}

function detectSections(text) {
  const lowered = lower(text)
  return {
    summary: hasAnyHeader(lowered, SECTION_HEADERS.summary),
    skills: hasAnyHeader(lowered, SECTION_HEADERS.skills),
    experience: hasAnyHeader(lowered, SECTION_HEADERS.experience),
    education: hasAnyHeader(lowered, SECTION_HEADERS.education),
    certifications: hasAnyHeader(lowered, SECTION_HEADERS.certifications),
  }
}

function detectContact(text) {
  return {
    email: EMAIL_REGEX.test(text),
    phone: PHONE_REGEX.test(text),
  }
}

function countBulletLines(text) {
  let count = 0
  const regex = new RegExp(BULLET_REGEX.source, 'g')
  let match
  while ((match = regex.exec(text)) !== null) {
    count += 1
  }
  return count
}

function detectMeasurableLines(text) {
  const lines = text.split(/\n+/)
  return lines.filter((line) => MEASURABLE_REGEX.test(line)).length
}

function detectStrongActionVerbCount(text) {
  const lowered = lower(text)
  let count = 0
  for (const verb of STRONG_ACTION_VERBS) {
    const re = new RegExp(`(^|[^a-z])${verb}([^a-z]|$)`, 'g')
    const matches = lowered.match(re)
    if (matches) count += matches.length
  }
  return count
}

function detectWeakPhrases(text) {
  const lowered = lower(text)
  const hits = []
  for (const phrase of WEAK_PHRASES) {
    if (lowered.includes(phrase)) hits.push(phrase)
  }
  return hits
}

function detectAtsRisks(text) {
  const risks = []
  // Multi-column layouts often produce extremely long lines of unbroken text
  // OR very short fragmented lines. Both are ATS hostile.
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  if (lines.length > 0) {
    const tinyLineRatio = lines.filter((line) => line.length > 0 && line.length < 4).length / lines.length
    if (tinyLineRatio > 0.25) {
      risks.push('Layout produced many fragmented short lines, which can indicate a multi-column design ATS systems struggle with.')
    }
  }
  // Headers detection failed entirely
  const sections = detectSections(text)
  const sectionHits = Object.values(sections).filter(Boolean).length
  if (sectionHits <= 1) {
    risks.push('No clear section headings detected. Use standard headings like Skills, Experience, and Education so ATS can parse your resume.')
  }
  // Excessive non-ASCII / decorative characters
  const decorativeMatches = text.match(/[─-▟■-◿☀-⛿]/g)
  if (decorativeMatches && decorativeMatches.length > 5) {
    risks.push('Decorative symbols or shapes were detected. Stick to simple bullet points (• or -) so ATS systems can read them.')
  }
  return risks
}

function buildJobDescriptionKeywords(jobDescription) {
  if (!jobDescription) return []
  const tokens = tokenize(jobDescription)
  const counts = new Map()
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1)
  }
  // Surface tokens that appear more than once and look meaningful.
  const candidates = [...counts.entries()]
    .filter(([token, count]) => count >= 1 && token.length >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([token]) => token)
  // Cap keyword list so a JD with thousands of words doesn't dominate matching.
  return candidates.slice(0, 30)
}

function buildRoleKeywords(targetJobTitle) {
  if (!targetJobTitle) return []
  const lowered = lower(targetJobTitle)
  for (const entry of ROLE_KEYWORDS) {
    if (entry.match.some((tag) => lowered.includes(tag))) {
      return entry.keywords
    }
  }
  return []
}

function computeKeywordOverlap(resumeText, keywords) {
  if (!keywords || keywords.length === 0) {
    return { matched: [], missing: [], matchPercentage: 0 }
  }
  const loweredResume = lower(resumeText)
  const matched = []
  const missing = []
  for (const keyword of keywords) {
    const normalized = lower(keyword)
    if (!normalized) continue
    if (loweredResume.includes(normalized)) {
      matched.push(keyword)
    } else {
      missing.push(keyword)
    }
  }
  const matchPercentage = keywords.length
    ? Math.round((matched.length / keywords.length) * 100)
    : 0
  return { matched, missing, matchPercentage }
}

function detectTitleMatch(resumeText, targetJobTitle) {
  if (!targetJobTitle) return { matched: false, similar: false }
  const lowered = lower(resumeText)
  const target = lower(targetJobTitle)
  if (lowered.includes(target)) return { matched: true, similar: true }
  // Check whether at least half the title tokens appear somewhere
  const tokens = tokenize(targetJobTitle)
  if (tokens.length === 0) return { matched: false, similar: false }
  const present = tokens.filter((token) => lowered.includes(token)).length
  return { matched: false, similar: present / tokens.length >= 0.5 }
}

function scoreAtsReadability(text, sections, risks) {
  let score = 20
  if (text.length < 600) score -= 6
  if (sections.experience === false) score -= 4
  if (sections.skills === false) score -= 3
  score -= Math.min(8, risks.length * 4)
  return clampScore(score, 20)
}

function scoreKeywordMatch(matchPercentage, hasAnyTarget) {
  if (!hasAnyTarget) {
    // Without a target role or JD we can't meaningfully score keyword match.
    // Give a neutral baseline so unscored doesn't tank the total.
    return 15
  }
  // matchPercentage 0..100 → 0..25
  return clampScore((matchPercentage / 100) * 25, 25)
}

function scoreExperienceRelevance({ sections, titleMatch, matchPercentage, hasAnyTarget, measurableCount, bulletCount }) {
  let score = 20
  if (!sections.experience) score -= 10
  if (bulletCount < 3) score -= 4
  if (measurableCount === 0) score -= 4
  if (hasAnyTarget) {
    if (!titleMatch.matched && !titleMatch.similar) score -= 6
    else if (!titleMatch.matched && titleMatch.similar) score -= 3
    if (matchPercentage < 25) score -= 3
  }
  return clampScore(score, 20)
}

function scoreFormatting({ bulletCount, weakPhraseCount, textLength }) {
  let score = 15
  if (bulletCount < 3) score -= 4
  if (weakPhraseCount > 3) score -= 3
  if (textLength < 800) score -= 3
  if (textLength > 8000) score -= 2 // Very long, likely poorly formatted
  return clampScore(score, 15)
}

function scoreGrammarClarity({ weakPhrases, strongActionVerbs, repetitionScore }) {
  let score = 10
  if (weakPhrases.length > 3) score -= 3
  if (strongActionVerbs < 3) score -= 3
  if (repetitionScore > 0.6) score -= 3
  return clampScore(score, 10)
}

function scoreRequiredSections({ contact, sections }) {
  let score = 0
  if (contact.email) score += 3
  if (contact.phone) score += 2
  if (sections.experience) score += 2
  if (sections.skills) score += 1
  if (sections.education) score += 1
  if (sections.summary) score += 1
  return clampScore(score, 10)
}

function detectRepetition(text) {
  const tokens = tokenize(text)
  if (tokens.length < 50) return 0
  const counts = new Map()
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1)
  const totals = [...counts.values()]
  const heavyHitters = totals.filter((count) => count > tokens.length * 0.03).length
  return Math.min(1, heavyHitters / 10)
}

function labelForScore(score) {
  if (score >= 90) return 'Excellent'
  if (score >= 75) return 'Strong'
  if (score >= 60) return 'Needs Improvement'
  if (score >= 40) return 'Weak'
  return 'Not Ready'
}

function summaryForScore(score, label) {
  if (label === 'Excellent') {
    return 'Your resume is in great shape. Small refinements could still help against highly competitive job posts.'
  }
  if (label === 'Strong') {
    return 'Your resume has a solid foundation. A few targeted tweaks will sharpen it for specific roles.'
  }
  if (label === 'Needs Improvement') {
    return 'Your resume has a decent foundation, but it needs stronger job-specific keywords and clearer formatting.'
  }
  if (label === 'Weak') {
    return 'There are several issues holding this resume back. Focus on the problems below before applying.'
  }
  return "This resume isn't ready to send yet. Use the recommendations below as a rebuild checklist."
}

function buildStrengths({ contact, sections, bulletCount, matchPercentage, hasAnyTarget, strongActionVerbs, measurableCount }) {
  const strengths = []
  if (contact.email && contact.phone) strengths.push('Contact information (email and phone) was found.')
  else if (contact.email) strengths.push('Contact email was found.')
  if (sections.experience) strengths.push('Work experience section appears to be present.')
  if (sections.skills) strengths.push('A skills section was detected.')
  if (sections.education) strengths.push('Education section was detected.')
  if (bulletCount >= 6) strengths.push('Resume uses bullet points to organize accomplishments.')
  if (strongActionVerbs >= 6) strengths.push('Strong action verbs are used throughout your experience.')
  if (measurableCount >= 3) strengths.push('You include measurable results, which hiring managers value.')
  if (hasAnyTarget && matchPercentage >= 50) {
    strengths.push('Resume contains many of the keywords the target role is looking for.')
  }
  return strengths.slice(0, 5)
}

function buildProblems({ contact, sections, bulletCount, measurableCount, weakPhrases, titleMatch, matchPercentage, hasAnyTarget, atsRisks, repetitionScore, strongActionVerbs }) {
  const problems = []
  if (!contact.email) problems.push('No email address was detected in your resume.')
  if (!contact.phone) problems.push('No phone number was detected in your resume.')
  if (!sections.experience) problems.push('No clear Work Experience section was detected.')
  if (!sections.skills) problems.push('No clear Skills section was detected.')
  if (bulletCount < 3) problems.push('Very few bullet points were detected - your accomplishments are hard to scan quickly.')
  if (measurableCount === 0) problems.push('No measurable results (numbers, percentages, dollar amounts) were found.')
  if (weakPhrases.length >= 3) problems.push('Several vague phrases were used, like "responsible for" or "duties included." Lead with strong action verbs instead.')
  if (strongActionVerbs < 3) problems.push('Few strong action verbs were detected. Replace passive language with verbs like led, built, delivered, resolved.')
  if (hasAnyTarget && !titleMatch.matched && !titleMatch.similar) {
    problems.push('Your resume does not clearly reference the target job title or related terms.')
  }
  if (hasAnyTarget && matchPercentage < 30) {
    problems.push('The resume does not strongly match the keywords for the target job.')
  }
  if (atsRisks.length > 0) {
    problems.push('Your formatting may not parse cleanly in ATS systems - see ATS risks for details.')
  }
  if (repetitionScore > 0.6) {
    problems.push('Several words are repeated heavily, which makes the resume feel padded.')
  }
  return problems.slice(0, 6)
}

function buildRewriteExamples({ weakPhrases, sections }) {
  const examples = []
  if (weakPhrases.includes('responsible for')) {
    examples.push({
      original: 'Responsible for helping customers with their issues.',
      improved: 'Resolved 40+ customer issues per week, reducing repeat support requests by 30%.',
    })
  }
  if (weakPhrases.includes('duties included')) {
    examples.push({
      original: 'Duties included answering phones and scheduling appointments.',
      improved: 'Managed a 50-call/day phone queue and scheduled 200+ appointments per month with zero double-bookings.',
    })
  }
  if (!sections.skills) {
    examples.push({
      original: 'No skills section.',
      improved: 'Add a Skills section near the top listing 8-12 specific tools and abilities relevant to the role.',
    })
  }
  if (examples.length === 0) {
    examples.push({
      original: 'Helped customers with computer problems.',
      improved: 'Resolved hardware and software issues for 25+ customers daily, improving response time by 20%.',
    })
  }
  return examples.slice(0, 4)
}

function buildNextSteps({ matchPercentage, hasAnyTarget, contact, sections, atsRisks, measurableCount, missingKeywords }) {
  const steps = []
  if (hasAnyTarget && missingKeywords && missingKeywords.length) {
    const sample = missingKeywords.slice(0, 6).join(', ')
    steps.push(`Add 5-8 keywords from the target role to your skills or experience: ${sample}.`)
  }
  if (measurableCount < 3) {
    steps.push('Rewrite at least 3 bullet points to include numbers, percentages, or other measurable results.')
  }
  if (!contact.email) steps.push('Add an email address to your contact section at the top of the resume.')
  if (!contact.phone) steps.push('Add a phone number to your contact section at the top of the resume.')
  if (!sections.skills) steps.push('Add a clear Skills section so ATS systems can match you to job posts.')
  if (!sections.summary) steps.push('Add a 2-3 sentence summary at the top targeting the role you want.')
  if (atsRisks.length > 0) steps.push('Simplify your formatting: no tables, no columns, no graphics, no decorative symbols.')
  steps.push('Keep the resume to one page if you have less than 10 years of experience, two pages otherwise.')
  return steps.slice(0, 7)
}

export function analyzeResume(rawResumeText, options = {}) {
  const targetJobTitle = String(options.targetJobTitle || '').trim()
  const jobDescription = String(options.jobDescription || '').trim()

  const text = normalizeText(rawResumeText)
  const hasAnyTarget = Boolean(targetJobTitle || jobDescription)

  const sections = detectSections(text)
  const contact = detectContact(text)
  const bulletCount = countBulletLines(text)
  const measurableCount = detectMeasurableLines(text)
  const strongActionVerbs = detectStrongActionVerbCount(text)
  const weakPhrases = detectWeakPhrases(text)
  const atsRisks = detectAtsRisks(text)
  const repetitionScore = detectRepetition(text)
  const titleMatch = detectTitleMatch(text, targetJobTitle)

  const jdKeywords = buildJobDescriptionKeywords(jobDescription)
  const roleKeywords = buildRoleKeywords(targetJobTitle)
  const keywordSet = jdKeywords.length > 0 ? jdKeywords : roleKeywords
  const keywordResult = computeKeywordOverlap(text, keywordSet)

  const atsScore = scoreAtsReadability(text, sections, atsRisks)
  const keywordScore = scoreKeywordMatch(keywordResult.matchPercentage, hasAnyTarget)
  const experienceScore = scoreExperienceRelevance({
    sections,
    titleMatch,
    matchPercentage: keywordResult.matchPercentage,
    hasAnyTarget,
    measurableCount,
    bulletCount,
  })
  const formattingScore = scoreFormatting({
    bulletCount,
    weakPhraseCount: weakPhrases.length,
    textLength: text.length,
  })
  const grammarScore = scoreGrammarClarity({
    weakPhrases,
    strongActionVerbs,
    repetitionScore,
  })
  const sectionsScore = scoreRequiredSections({ contact, sections })

  const overallScore = clampScore(
    atsScore + keywordScore + experienceScore + formattingScore + grammarScore + sectionsScore,
    100
  )
  const label = labelForScore(overallScore)

  const strengths = buildStrengths({
    contact,
    sections,
    bulletCount,
    matchPercentage: keywordResult.matchPercentage,
    hasAnyTarget,
    strongActionVerbs,
    measurableCount,
  })
  const problems = buildProblems({
    contact,
    sections,
    bulletCount,
    measurableCount,
    weakPhrases,
    titleMatch,
    matchPercentage: keywordResult.matchPercentage,
    hasAnyTarget,
    atsRisks,
    repetitionScore,
    strongActionVerbs,
  })
  const rewriteExamples = buildRewriteExamples({ weakPhrases, sections })
  const nextSteps = buildNextSteps({
    matchPercentage: keywordResult.matchPercentage,
    hasAnyTarget,
    contact,
    sections,
    atsRisks,
    measurableCount,
    missingKeywords: keywordResult.missing,
  })

  return {
    overallScore,
    label,
    summary: summaryForScore(overallScore, label),
    breakdown: {
      atsReadability: atsScore,
      keywordMatch: keywordScore,
      experienceRelevance: experienceScore,
      formatting: formattingScore,
      grammarClarity: grammarScore,
      requiredSections: sectionsScore,
    },
    strengths,
    problems,
    atsRisks,
    keywordFeedback: {
      matchedKeywords: keywordResult.matched,
      missingKeywords: keywordResult.missing,
      matchPercentage: keywordResult.matchPercentage,
      source: jdKeywords.length > 0 ? 'job_description' : (roleKeywords.length > 0 ? 'role_dictionary' : 'none'),
    },
    rewriteExamples,
    nextSteps,
    meta: {
      hasJobDescription: Boolean(jobDescription),
      hasTargetJobTitle: Boolean(targetJobTitle),
      textLength: text.length,
      bulletCount,
      measurableCount,
      strongActionVerbCount: strongActionVerbs,
    },
  }
}

// Free preview is a trimmed slice of the full report. The frontend should
// teaser the locked sections so users know what they unlock with payment.
export function previewFromFullReport(fullReport) {
  if (!fullReport) return null
  return {
    overallScore: fullReport.overallScore,
    label: fullReport.label,
    summary: fullReport.summary,
    strengths: (fullReport.strengths || []).slice(0, 3),
    problems: (fullReport.problems || []).slice(0, 3),
    keywordFeedback: {
      matchPercentage: fullReport.keywordFeedback?.matchPercentage ?? 0,
      source: fullReport.keywordFeedback?.source || 'none',
    },
    meta: {
      hasJobDescription: fullReport.meta?.hasJobDescription || false,
      hasTargetJobTitle: fullReport.meta?.hasTargetJobTitle || false,
    },
  }
}
