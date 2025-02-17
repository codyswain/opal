import { useMemo } from 'react';
import navbarItems from '../config/navbarItems';

export const useNavbarItems = () => {
  return useMemo(() => navbarItems, []);
};