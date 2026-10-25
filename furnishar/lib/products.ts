import type { Product } from './types';

export const products: Product[] = [
  {"id":"kivik-sofa","name":"KIVIK","category":"sofa","price":799,"dimensions":{"width":2.28,"depth":0.95,"height":0.83},"color":"#8B7D6B","styleTags":["modern","neutral","minimalist"],"ikeaUrl":"https://www.ikea.com/us/en/p/kivik-sofa-tibbleby-beige-s59440564/","imageUrl":"https://www.ikea.com/us/en/images/products/kivik-sofa-tibbleby-beige__1057937_pe848268_s5.jpg"},
  {"id":"friheten-sleeper","name":"FRIHETEN","category":"sofa","price":499,"dimensions":{"width":2.30,"depth":1.51,"height":0.66},"color":"#3D3D3D","styleTags":["functional","modern","dark"],"ikeaUrl":"https://www.ikea.com/us/en/p/friheten-sleeper-sectional-3-seat-w-storage-skiftebo-dark-gray-s69216757/","imageUrl":""},
  {"id":"bekant-desk","name":"BEKANT","category":"desk","price":449,"dimensions":{"width":1.60,"depth":0.80,"height":0.65},"color":"#FFFFFF","styleTags":["office","modern","adjustable"],"ikeaUrl":"https://www.ikea.com/us/en/p/bekant-desk-sit-stand-white-s49022538/","imageUrl":""},
  {"id":"lagkapten-desk","name":"LAGKAPTEN","category":"desk","price":89,"dimensions":{"width":1.40,"depth":0.60,"height":0.73},"color":"#D4C4A8","styleTags":["simple","budget","neutral"],"ikeaUrl":"https://www.ikea.com/us/en/p/lagkapten-adils-desk-white-stained-oak-effect-white-s99417569/","imageUrl":""},
  {"id":"micke-desk","name":"MICKE","category":"desk","price":149,"dimensions":{"width":1.05,"depth":0.50,"height":0.75},"color":"#FFFFFF","styleTags":["compact","modern","storage"],"ikeaUrl":"https://www.ikea.com/us/en/p/micke-desk-white-30213076/","imageUrl":""},
  {"id":"kallax-shelf","name":"KALLAX","category":"bookshelf","price":69,"dimensions":{"width":0.77,"depth":0.39,"height":1.47},"color":"#FFFFFF","styleTags":["modern","versatile","storage"],"ikeaUrl":"https://www.ikea.com/us/en/p/kallax-shelf-unit-white-80275887/","imageUrl":""},
  {"id":"billy-bookcase","name":"BILLY","category":"bookshelf","price":79,"dimensions":{"width":0.80,"depth":0.28,"height":2.02},"color":"#FFFFFF","styleTags":["classic","tall","traditional"],"ikeaUrl":"https://www.ikea.com/us/en/p/billy-bookcase-white-00263850/","imageUrl":""},
  {"id":"tiphede-rug","name":"TIPHEDE","category":"rug","price":29,"dimensions":{"width":1.55,"depth":2.20,"height":0.01},"color":"#F5F0E8","styleTags":["natural","budget","boho"],"ikeaUrl":"https://www.ikea.com/us/en/p/tiphede-rug-flatwoven-natural-off-white-80456564/","imageUrl":""},
  {"id":"stoense-rug","name":"STOENSE","category":"rug","price":129,"dimensions":{"width":1.70,"depth":2.40,"height":0.02},"color":"#8B8B8B","styleTags":["modern","plush","neutral"],"ikeaUrl":"https://www.ikea.com/us/en/p/stoense-rug-low-pile-medium-gray-50423339/","imageUrl":""},
  {"id":"tertial-lamp","name":"TERTIAL","category":"lamp","price":12,"dimensions":{"width":0.17,"depth":0.17,"height":0.65},"color":"#3D3D3D","styleTags":["industrial","budget","functional"],"ikeaUrl":"https://www.ikea.com/us/en/p/tertial-work-lamp-dark-gray-50355395/","imageUrl":""},
  {"id":"hektar-lamp","name":"HEKTAR","category":"lamp","price":54,"dimensions":{"width":0.38,"depth":0.38,"height":1.81},"color":"#3D3D3D","styleTags":["industrial","statement","dark"],"ikeaUrl":"https://www.ikea.com/us/en/p/hektar-floor-lamp-dark-gray-80216546/","imageUrl":""},
  {"id":"lack-table","name":"LACK","category":"coffee_table","price":10,"dimensions":{"width":0.55,"depth":0.55,"height":0.45},"color":"#FFFFFF","styleTags":["budget","simple","modern"],"ikeaUrl":"https://www.ikea.com/us/en/p/lack-side-table-white-30449908/","imageUrl":""},
  {"id":"listerby-table","name":"LISTERBY","category":"coffee_table","price":199,"dimensions":{"width":1.40,"depth":0.60,"height":0.45},"color":"#8B6914","styleTags":["natural","wood","scandinavian"],"ikeaUrl":"https://www.ikea.com/us/en/p/listerby-coffee-table-oak-veneer-30513845/","imageUrl":""},
  {"id":"stockholm-table","name":"STOCKHOLM","category":"coffee_table","price":299,"dimensions":{"width":1.80,"depth":0.59,"height":0.40},"color":"#C4A882","styleTags":["premium","scandinavian","elegant"],"ikeaUrl":"https://www.ikea.com/us/en/p/stockholm-coffee-table-walnut-veneer-60239713/","imageUrl":""},
  {"id":"markus-chair","name":"MARKUS","category":"chair","price":229,"dimensions":{"width":0.62,"depth":0.60,"height":1.40},"color":"#1A1A1A","styleTags":["office","ergonomic","dark"],"ikeaUrl":"https://www.ikea.com/us/en/p/markus-office-chair-vissle-dark-gray-90289172/","imageUrl":""},
  {"id":"poang-chair","name":"POÄNG","category":"chair","price":149,"dimensions":{"width":0.68,"depth":0.82,"height":1.00},"color":"#D4C4A8","styleTags":["classic","comfortable","scandinavian"],"ikeaUrl":"https://www.ikea.com/us/en/p/poaeng-armchair-birch-veneer-knisa-light-beige-s29306713/","imageUrl":""}
];

export const CATEGORIES = [
  { id: 'sofa', label: 'Sofa' },
  { id: 'desk', label: 'Desk' },
  { id: 'bookshelf', label: 'Bookshelf' },
  { id: 'rug', label: 'Rug' },
  { id: 'lamp', label: 'Lamp' },
  { id: 'coffee_table', label: 'Coffee Table' },
  { id: 'chair', label: 'Chair' },
] as const;

export function getProduct(id: string, catalog: Product[] = products): Product | undefined {
  return catalog.find((p) => p.id === id);
}
