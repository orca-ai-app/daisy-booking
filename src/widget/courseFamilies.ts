// Course families for the class-finder filters and colour coding.
//
// The six families and their colours are the scheme Jenni approved on 17 Sep
// 2026 ("Colour coding for the new filters" thread), including her amendments:
// the Duty of Care classes and Basic Life Saver sit with workplace, Anaphylaxis
// sits with paediatric, and the online classes take yellow. Bespoke and
// anything unclassified take violet.
//
// Classification is an explicit slug map covering every live template, with a
// name-keyword fallback so a template created after this shipped still lands
// somewhere sensible. Swapping a family's colour is a one-line change here.

export interface CourseFamily {
  id: string;
  label: string;
  colour: string;
  /** Text colour for the badge — yellow needs dark text to stay readable. */
  text: string;
}

export const COURSE_FAMILIES: CourseFamily[] = [
  { id: 'baby-family', label: 'Baby & family', colour: '#E85D9E', text: '#FFFFFF' },
  { id: 'paediatric', label: 'Paediatric', colour: '#006FAC', text: '#FFFFFF' },
  { id: 'workplace', label: 'Workplace', colour: '#F0745A', text: '#FFFFFF' },
  { id: 'teaching-children', label: 'Teaching children', colour: '#67A671', text: '#FFFFFF' },
  { id: 'online', label: 'Live online', colour: '#FFCB05', text: '#1A4359' },
  { id: 'bespoke-other', label: 'Bespoke & other', colour: '#8E6BC1', text: '#FFFFFF' },
];

export function familyById(id: string): CourseFamily | undefined {
  return COURSE_FAMILIES.find((f) => f.id === id);
}

/** Every live template slug, mapped per the approved scheme. */
const SLUG_FAMILY: Record<string, string> = {
  // Pink — baby & family (Duty of Care removed per Jenni's amendment)
  'baby-child-first-aid': 'baby-family',
  'baby-child-2hr': 'baby-family',
  'family-first-aid': 'baby-family',
  'baby-first-aid-essentials': 'baby-family',
  // Blue — paediatric (plus Anaphylaxis per Jenni's amendment)
  'level-3-emergency-paediatric-first-aid': 'paediatric',
  'level-3-blended-paediatric-first-aid': 'paediatric',
  'level-6-emergency-paediatric-first-aid': 'paediatric',
  'level-6-blended-paediatric-first-aid': 'paediatric',
  'emergency-paediatric': 'paediatric',
  'paediatric-aow': 'paediatric',
  'blended-learning': 'paediatric',
  'anaphylaxis-awareness': 'paediatric',
  // Coral — workplace (plus Duty of Care and Basic Life Saver per Jenni)
  'emergency-first-aid-at-work': 'workplace',
  'first-aid-at-work': 'workplace',
  'baby-child-first-aid-duty-of-care': 'workplace',
  'baby-child-full-day': 'workplace',
  'basic-life-saver': 'workplace',
  // Green — teaching children
  'first-aid-for-children': 'teaching-children',
  // Yellow — live online
  'online-class': 'online',
  'baby-essentials': 'online',
  // Violet — bespoke
  'bespoke-first-aid': 'bespoke-other',
  'corporate-bespoke': 'bespoke-other',
};

/**
 * Family for a course card. Slug map first; keyword fallback on the template
 * name for templates created after this shipped. Order matters in the
 * fallback: online before baby (an "Online Baby..." class is online), and
 * workplace/duty-of-care before baby for the same reason.
 */
export function familyForCourse(course: {
  template_slug?: string | null;
  template_name?: string | null;
}): string {
  const slug = (course.template_slug ?? '').toLowerCase();
  if (SLUG_FAMILY[slug]) return SLUG_FAMILY[slug];
  const name = (course.template_name ?? '').toLowerCase();
  if (name.includes('online')) return 'online';
  if (name.includes('bespoke') || name.includes('private') || name.includes('corporate')) {
    return 'bespoke-other';
  }
  if (
    name.includes('at work') ||
    name.includes('efaw') ||
    name.includes('duty of care') ||
    name.includes('basic life') ||
    /\bfaw\b/.test(name) ||
    /\bbls\b/.test(name)
  ) {
    return 'workplace';
  }
  if (
    name.includes('paediatric') ||
    name.includes('pediatric') ||
    name.includes('anaphylaxis') ||
    name.includes('epfa') ||
    /\bpfa\b/.test(name) ||
    name.includes('level 3') ||
    name.includes('level 6')
  ) {
    return 'paediatric';
  }
  if (name.includes('teach') || name.includes('for children') || name.includes('junior')) {
    return 'teaching-children';
  }
  if (name.includes('baby') || name.includes('family') || name.includes('child')) {
    return 'baby-family';
  }
  return 'bespoke-other';
}
