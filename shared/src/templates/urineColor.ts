import { EnumValue } from '../types';

export const URINE_COLOR: EnumValue[] = [
  { value: 'pale_yellow',    label: 'Pale yellow',    color: '#FFFACD', description: 'Optimal hydration' },
  { value: 'clear',          label: 'Clear',          color: '#F0FFFF', description: 'Over-hydrated / drinking a lot' },
  { value: 'yellow',         label: 'Yellow',         color: '#FFD700', description: 'Normal, well hydrated' },
  { value: 'dark_yellow',    label: 'Dark yellow',    color: '#FFA500', description: 'Normal, mild dehydration' },
  { value: 'amber',          label: 'Amber / Honey',  color: '#FFBF00', description: 'Dehydrated — drink more water' },
  { value: 'orange',         label: 'Orange',         color: '#FF8C00', description: 'Severely dehydrated, or certain medications/foods' },
  { value: 'pink_red',       label: 'Pink / Red',     color: '#FF6B6B', description: 'Blood possible — discuss with doctor' },
  { value: 'brown',          label: 'Brown',          color: '#8B4513', description: 'Possible muscle breakdown or liver issue — discuss with doctor' },
  { value: 'cloudy',         label: 'Cloudy / Murky', color: '#D3D3D3', description: 'May indicate infection or kidney stones' },
  { value: 'blue_green',     label: 'Blue / Green',   color: '#00CED1', description: 'Rare — certain medications or dyes' },
];
