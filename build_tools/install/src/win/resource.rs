//! Utilities for working with Resources embedded in Windows executables.

use crate::prelude::*;

use windows::Win32::Foundation;
use windows::Win32::System::LibraryLoader;
use windows::core::HSTRING;

/// Get binary resource embedded in the current executable.
///
/// The resource must be compiled into the current executable as `RCDATA`.
#[context("Failed to get binary resource named `{name}`.")]
pub fn get_binary(name: &str) -> Result<&'static [u8]> {
    unsafe {
        // Clear error, so any `GetLastError` call after this one will return actual error from the
        // subsequent calls.
        Foundation::SetLastError(Foundation::WIN32_ERROR::default());
        let resource =
            LibraryLoader::FindResourceW(None, &HSTRING::from(name), crate::win::RT_RCDATA);
        // `windows` 0.62 changed `GetLastError` to return the raw `WIN32_ERROR`; up to 0.52 the
        // binding called `.ok()` itself and handed back a `Result`. `to_hresult().ok()` restores
        // that — `WIN32_ERROR` no longer has an `ok()` of its own.
        Foundation::GetLastError()
            .to_hresult()
            .ok()
            .with_context(|| format!("Failed to find resource: {name:?}"))?;
        let global = LibraryLoader::LoadResource(None, resource).unwrap();
        let data = LibraryLoader::LockResource(global);
        let size = LibraryLoader::SizeofResource(None, resource);
        Ok(std::slice::from_raw_parts(data as *const u8, size as _))
    }
}
