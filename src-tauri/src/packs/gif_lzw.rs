pub(super) fn validate(
    data: &[u8],
    minimum: u8,
    pixels: u32,
    palette_size: u16,
    transparent: Option<u8>,
) -> Result<(), String> {
    let invalid = || "GIF LZW 压缩数据无效".to_string();
    let clear = 1usize << minimum;
    let end = clear + 1;
    let mut lengths = [0u32; 4096];
    let mut first = [0u16; 4096];
    let mut maximum = [0u16; 4096];
    for index in 0..clear {
        lengths[index] = 1;
        first[index] = u16::try_from(index).map_err(|_| invalid())?;
        maximum[index] = if transparent.map(u16::from) == Some(first[index]) {
            0
        } else {
            first[index]
        };
    }
    let mut next = end + 1;
    let mut width = minimum + 1;
    let mut bit = 0usize;
    let mut previous: Option<usize> = None;
    let mut output = 0u32;
    let mut started = false;
    loop {
        if bit + usize::from(width) > data.len() * 8 {
            return Err(format!("GIF LZW invalid at line {} bit {bit} output {output}/{pixels} next {next} width {width} palette {palette_size}", line!()));
        }
        let mut code = 0usize;
        for shift in 0..usize::from(width) {
            let offset = bit + shift;
            code |= usize::from((data[offset / 8] >> (offset % 8)) & 1) << shift;
        }
        bit += usize::from(width);
        if !started && code != clear {
            return Err(format!("GIF LZW invalid at line {} bit {bit} output {output}/{pixels} next {next} width {width} palette {palette_size}", line!()));
        }
        started = true;
        if code == clear {
            next = end + 1;
            width = minimum + 1;
            previous = None;
            continue;
        }
        if code == end {
            return if output == pixels {
                Ok(())
            } else {
                Err(invalid())
            };
        }
        if code > next || code >= 4096 {
            return Err(format!("GIF LZW invalid at line {} bit {bit} output {output}/{pixels} next {next} width {width} palette {palette_size}", line!()));
        }
        if code == next {
            let prior = previous.ok_or_else(invalid)?;
            lengths[code] = lengths[prior] + 1;
            first[code] = first[prior];
            maximum[code] = maximum[prior];
        } else if code >= clear && code < end + 1 {
            return Err(format!("GIF LZW invalid at line {} bit {bit} output {output}/{pixels} next {next} width {width} palette {palette_size}", line!()));
        }
        if lengths[code] == 0 || maximum[code] >= palette_size {
            return Err(format!("GIF LZW invalid at line {} bit {bit} output {output}/{pixels} next {next} width {width} palette {palette_size}", line!()));
        }
        output = output.checked_add(lengths[code]).ok_or_else(invalid)?;
        if output > pixels {
            return Err(format!("GIF LZW invalid at line {} bit {bit} output {output}/{pixels} next {next} width {width} palette {palette_size}", line!()));
        }
        if let Some(prior) = previous {
            if next < 4096 {
                lengths[next] = lengths[prior] + 1;
                first[next] = first[prior];
                maximum[next] =
                    maximum[prior].max(if transparent.map(u16::from) == Some(first[code]) {
                        0
                    } else {
                        first[code]
                    });
                next += 1;
                if next == 1usize << width && width < 12 {
                    width += 1;
                }
            }
        }
        previous = Some(code);
    }
}
