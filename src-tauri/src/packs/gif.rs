use std::io::{Cursor, Read};

fn take<const N: usize>(input: &mut Cursor<&[u8]>) -> Result<[u8; N], String> {
    let mut bytes = [0; N];
    input
        .read_exact(&mut bytes)
        .map_err(|_| "GIF 数据截断".to_string())?;
    Ok(bytes)
}

fn skip(input: &mut Cursor<&[u8]>, count: usize) -> Result<(), String> {
    let remaining = input
        .get_ref()
        .len()
        .saturating_sub(usize::try_from(input.position()).map_err(|error| error.to_string())?);
    if count > remaining {
        return Err("GIF 数据截断".into());
    }
    input.set_position(input.position() + u64::try_from(count).map_err(|error| error.to_string())?);
    Ok(())
}

fn blocks(input: &mut Cursor<&[u8]>) -> Result<usize, String> {
    let mut total = 0;
    loop {
        let [size] = take(input)?;
        if size == 0 {
            return Ok(total);
        }
        skip(input, usize::from(size))?;
        total += usize::from(size);
    }
}

pub(super) fn validate(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("GIF 文件过大".into());
    }
    let mut input = Cursor::new(bytes);
    let header = take::<6>(&mut input)?;
    if &header != b"GIF87a" && &header != b"GIF89a" {
        return Err("GIF 签名无效".into());
    }
    let screen = take::<7>(&mut input)?;
    if u16::from_le_bytes([screen[0], screen[1]]) != 240
        || u16::from_le_bytes([screen[2], screen[3]]) != 240
    {
        return Err("GIF 画布必须为 240×240".into());
    }
    let global = screen[4] & 0x80 != 0;
    if global {
        skip(&mut input, 3 * (1usize << ((screen[4] & 7) + 1)))?;
    }
    let mut frames = 0;
    let mut transparent = None;
    loop {
        match take::<1>(&mut input)?[0] {
            0x3b => {
                if frames == 0
                    || input.position()
                        != u64::try_from(bytes.len()).map_err(|error| error.to_string())?
                {
                    return Err("GIF 无帧或存在尾部数据".into());
                }
                return Ok(());
            }
            0x21 => {
                let [label] = take(&mut input)?;
                match label {
                    0xf9 => {
                        let data = take::<6>(&mut input)?;
                        transparent = (data[1] & 1 != 0).then_some(data[4]);
                        if data[0] != 4 || data[5] != 0 || data[1] & 0xe0 != 0 {
                            return Err("GIF 控制扩展无效".into());
                        }
                    }
                    0xff | 0x01 => {
                        let [length] = take(&mut input)?;
                        if length != if label == 0xff { 11 } else { 12 } {
                            return Err("GIF 扩展头无效".into());
                        }
                        skip(&mut input, usize::from(length))?;
                        blocks(&mut input)?;
                    }
                    0xfe => {
                        blocks(&mut input)?;
                    }
                    _ => return Err("GIF 扩展类型无效".into()),
                }
            }
            0x2c => {
                let descriptor = take::<9>(&mut input)?;
                let x = u16::from_le_bytes([descriptor[0], descriptor[1]]);
                let y = u16::from_le_bytes([descriptor[2], descriptor[3]]);
                let width = u16::from_le_bytes([descriptor[4], descriptor[5]]);
                let height = u16::from_le_bytes([descriptor[6], descriptor[7]]);
                if width == 0
                    || height == 0
                    || u32::from(x) + u32::from(width) > 240
                    || u32::from(y) + u32::from(height) > 240
                    || descriptor[8] & 0x18 != 0
                {
                    return Err("GIF 帧尺寸无效".into());
                }
                let local = descriptor[8] & 0x80 != 0;
                if local {
                    skip(&mut input, 3 * (1usize << ((descriptor[8] & 7) + 1)))?;
                }
                if !local && !global {
                    return Err("GIF 缺少调色板".into());
                }
                let [code_size] = take(&mut input)?;
                if !(2..=8).contains(&code_size) {
                    return Err("GIF 图像数据无效".into());
                }
                let mut compressed = Vec::new();
                loop {
                    let [size] = take(&mut input)?;
                    if size == 0 {
                        break;
                    }
                    for _ in 0..size {
                        compressed.push(take::<1>(&mut input)?[0]);
                    }
                }
                let palette_bits = if local { descriptor[8] } else { screen[4] };
                super::gif_lzw::validate(
                    &compressed,
                    code_size,
                    u32::from(width) * u32::from(height),
                    1u16 << ((palette_bits & 7) + 1),
                    transparent,
                )?;
                transparent = None;
                frames += 1;
                if frames > 1000 {
                    return Err("GIF 帧数过多".into());
                }
            }
            _ => return Err("GIF 块类型无效".into()),
        }
    }
}
