import axios from 'axios'; // Atau sesuaikan dengan instance axios/fetch Anda

const API_URL = '/api/medicines'; // Mengarah ke DB_MTC_MEDICINE

export const obatService = {
  getAll: () => axios.get(API_URL),
  getById: (id) => axios.get(`${API_URL}/${id}`),
  create: (formData) => axios.post(API_URL, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  update: (id, formData) => axios.put(`${API_URL}/${id}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  delete: (id) => axios.delete(`${API_URL}/${id}`),
};