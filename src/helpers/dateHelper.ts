/**
 * Date utility functions for the AI News Aggregator.
 * This module provides functions for parsing, formatting, and manipulating dates.
 * 
 * @module helpers
 */

import { DateConfig } from "../types";

/**
 * Parses a date string in YYYY-MM-DD format into a Date object.
 * 
 * @param dateStr - The date string to parse (YYYY-MM-DD format)
 * @returns A Date object representing the parsed date
 */
export const parseDate = (dateStr: String): any => {
    const [year, month, day] = dateStr.split("-").map(Number);
    return new Date(year, month - 1, day);
};

/**
 * Formats a Date object into a YYYY-MM-DD string.
 * 
 * @param dateObj - The Date object to format
 * @returns A string representation of the date in YYYY-MM-DD format
 */
export const formatDate = (dateObj: Date): string => {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, "0");
    const day = String(dateObj.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

/**
 * Adds one day to a Date object.
 * 
 * @param dateObj - The Date object to increment
 * @returns A new Date object representing the next day
 */
export const addOneDay = (dateObj: Date): Date => {
    const next = new Date(dateObj);
    next.setDate(next.getDate() + 1);
    return next;
};

/**
 * Executes a callback function for each date in a specified range.
 * 
 * This function:
 * 1. Determines the date range based on the filter configuration
 * 2. Iterates through each date in the range
 * 3. Calls the callback function with each date as a string (YYYY-MM-DD format)
 * 
 * The filter can specify:
 * - A date range (after and before dates)
 * - A specific date (during)
 * - All dates before a specific date (before)
 * - All dates after a specific date (after)
 * 
 * @param filter - The date filter configuration
 * @param callback - The function to call for each date
 * @returns A promise that resolves when all callbacks have been executed
 */
export const callbackDateRangeLogic = async (filter: DateConfig, callback: Function) => {
    if (filter.after && filter.before) {
      let current = parseDate(filter.after);
      const end = parseDate(filter.before);
      while (current <= end) {
        const dayStr = formatDate(current);
        await callback(dayStr);
        current = addOneDay(current);
      }
    } else if (filter.filterType === 'during' && filter.date) {
      await callback(filter.date);
    } else if (filter.filterType === 'before' && filter.date) {
      const earliest = new Date(2025, 0, 1);
      let current = earliest;
      const end = parseDate(filter.date);
      while (current <= end) {
        const dayStr = formatDate(current);
        await callback(dayStr);
        current = addOneDay(current);
      }
    } else if (filter.filterType === 'after' && filter.date) {
      let current = parseDate(filter.date);
      const today = new Date();
      while (current <= today) {
        const dayStr = formatDate(current);
        await callback(dayStr);
        current = addOneDay(current);
      }
    }
  }