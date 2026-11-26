import { departmentOptionLabel, departmentsOf, type Department } from '../shared/departments';
import { stationsOf } from '../shared/stations';
import { apiService } from './api';

/** Keep ids as option values even when two stations use the same department name. */
export function createDepartmentLabeler() {
  const settings = apiService.getSettings();
  const departments = departmentsOf(settings);
  const stations = stationsOf(settings);
  const users = apiService.getUsers();
  return (department: Department) => departmentOptionLabel(department, departments, stations, users);
}
