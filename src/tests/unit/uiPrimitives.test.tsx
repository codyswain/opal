import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Folder, Plus } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import {
  Badge,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  IconButton,
  Kbd,
  Menu,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
  Skeleton,
  Switch,
  TooltipProvider,
} from '@/renderer/shared/ui';

describe('compact controls', () => {
  it('gives icon-only actions a required accessible name and keyboard activation', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <TooltipProvider delayDuration={0}>
        <IconButton label="Create folder" shortcut="⌘N" onClick={onClick}>
          <Plus aria-hidden />
        </IconButton>
      </TooltipProvider>
    );

    const button = screen.getByRole('button', { name: 'Create folder' });
    await user.hover(button);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Create folder');
    expect(tooltip).toHaveTextContent('⌘N');
    await user.unhover(button);

    await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not activate disabled buttons', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <TooltipProvider>
        <IconButton label="Disabled action" disabled onClick={onClick}>
          <Plus aria-hidden />
        </IconButton>
      </TooltipProvider>
    );

    await user.click(
      screen.getByRole('button', { name: 'Disabled action' })
    );

    expect(onClick).not.toHaveBeenCalled();
  });

  it('exposes the unpressed state for toggle icon buttons', () => {
    render(
      <TooltipProvider>
        <IconButton label="Toggle inspector" active={false}>
          <Plus aria-hidden />
        </IconButton>
      </TooltipProvider>
    );

    expect(
      screen.getByRole('button', { name: 'Toggle inspector' })
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('uses radio semantics and arrow-key selection for segmented controls', async () => {
    const user = userEvent.setup();

    function Example() {
      const [value, setValue] = React.useState<'details' | 'gallery'>('details');
      return (
        <SegmentedControl<'details' | 'gallery'>
          label="View"
          value={value}
          onValueChange={setValue}
          options={[
            { value: 'details', label: 'Details' },
            { value: 'gallery', label: 'Gallery' },
          ]}
        />
      );
    }

    render(<Example />);
    const details = screen.getByRole('radio', { name: 'Details' });
    const gallery = screen.getByRole('radio', { name: 'Gallery' });
    expect(details).toBeChecked();

    details.focus();
    await user.keyboard('{ArrowRight}');

    expect(gallery).toBeChecked();
    expect(gallery).toHaveFocus();
  });

  it('keeps a tab stop when the selected segment is disabled', async () => {
    const user = userEvent.setup();
    render(
      <SegmentedControl<'details' | 'gallery'>
        label="View"
        value="details"
        onValueChange={vi.fn()}
        options={[
          { value: 'details', label: 'Details', disabled: true },
          { value: 'gallery', label: 'Gallery' },
        ]}
      />
    );

    await user.tab();

    expect(screen.getByRole('radio', { name: 'Gallery' })).toHaveFocus();
  });

  it('exposes checked and disabled switch behavior', async () => {
    const user = userEvent.setup();

    function Example() {
      const [checked, setChecked] = React.useState(false);
      return (
        <>
          <Switch
            label="Show hidden files"
            checked={checked}
            onCheckedChange={setChecked}
          />
          <Switch label="Unavailable option" disabled />
        </>
      );
    }

    render(<Example />);
    const toggle = screen.getByRole('switch', { name: 'Show hidden files' });
    await user.click(toggle);
    expect(toggle).toBeChecked();

    const disabled = screen.getByRole('switch', { name: 'Unavailable option' });
    await user.click(disabled);
    expect(disabled).not.toBeChecked();
  });

  it('reports chip selection with aria-pressed', async () => {
    const user = userEvent.setup();

    function Example() {
      const [selected, setSelected] = React.useState(false);
      return (
        <Chip selected={selected} onClick={() => setSelected((value) => !value)}>
          Images
        </Chip>
      );
    }

    render(<Example />);
    const chip = screen.getByRole('button', { name: 'Images' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('overlays', () => {
  it('dismisses a menu with Escape and restores trigger focus', async () => {
    const user = userEvent.setup();
    render(
      <Menu>
        <MenuTrigger asChild>
          <Button>File actions</Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem>Rename</MenuItem>
          <MenuItem>Move</MenuItem>
        </MenuContent>
      </Menu>
    );

    const trigger = screen.getByRole('button', { name: 'File actions' });
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('activates a menu item from the keyboard', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <Menu>
        <MenuTrigger asChild>
          <Button>More</Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={onSelect}>Rename</MenuItem>
        </MenuContent>
      </Menu>
    );

    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('exposes single-selection menu options as radio items', async () => {
    const user = userEvent.setup();

    function Example() {
      const [value, setValue] = React.useState('details');
      return (
        <>
          <Menu>
            <MenuTrigger asChild>
              <Button>Choose view</Button>
            </MenuTrigger>
            <MenuContent>
              <MenuRadioGroup value={value} onValueChange={setValue}>
                <MenuRadioItem value="details">Details</MenuRadioItem>
                <MenuRadioItem value="gallery">Gallery</MenuRadioItem>
              </MenuRadioGroup>
            </MenuContent>
          </Menu>
          <output>{value}</output>
        </>
      );
    }

    render(<Example />);
    await user.click(screen.getByRole('button', { name: 'Choose view' }));
    expect(
      screen.getByRole('menuitemradio', { name: 'Details' })
    ).toBeChecked();

    await user.click(
      screen.getByRole('menuitemradio', { name: 'Gallery' })
    );

    expect(screen.getByText('gallery')).toBeInTheDocument();
  });

  it('dismisses a popover with Escape and restores trigger focus', async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger asChild>
          <Button>Display options</Button>
        </PopoverTrigger>
        <PopoverContent>
          <label>
            Density
            <input aria-label="Density" />
          </label>
        </PopoverContent>
      </Popover>
    );

    const trigger = screen.getByRole('button', { name: 'Display options' });
    await user.click(trigger);
    expect(screen.getByRole('textbox', { name: 'Density' })).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('textbox', { name: 'Density' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('focuses dialog content, closes with Escape, and restores focus', async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Rename file</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename file</DialogTitle>
            <DialogDescription>Choose a new name.</DialogDescription>
          </DialogHeader>
          <input aria-label="File name" />
        </DialogContent>
      </Dialog>
    );

    const trigger = screen.getByRole('button', { name: 'Rename file' });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Rename file' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'File name' })).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe('feedback primitives', () => {
  it('keeps empty-state copy specific and its icon decorative', () => {
    render(
      <EmptyState
        Icon={Folder}
        title="No folders yet"
        description="Open a folder to start browsing."
        action={<Button>Open folder</Button>}
      />
    );

    expect(screen.getByText('No folders yet')).toBeInTheDocument();
    expect(screen.getByText('Open a folder to start browsing.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('marks skeletons as decorative while badges and shortcuts stay readable', () => {
    render(
      <>
        <Skeleton />
        <Badge tone="success">Synced</Badge>
        <Kbd>⌘K</Kbd>
      </>
    );

    expect(screen.getByTestId('skeleton')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Synced')).toBeInTheDocument();
    expect(screen.getByText('⌘K')).toBeInTheDocument();
  });
});

// Radix listens for the browser's click sequence; this also guards that a
// consumer using fireEvent still gets native button behavior.
it('keeps ordinary button click semantics', () => {
  const onClick = vi.fn();
  render(<Button onClick={onClick}>Apply</Button>);
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onClick).toHaveBeenCalledOnce();
});
