const mockSaveConfig = jest.fn().mockImplementation((name: string, config: any) => {
  return Promise.resolve(true);
});

export const saveConfig = mockSaveConfig; 